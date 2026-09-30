<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
if (!is_file(__DIR__ . '/config.php')) {
  http_response_code(503);
  echo json_encode(['error'=>'Server configuration is not installed.']);
  exit;
}
require_once __DIR__ . '/config.php';

function json_input(){ $raw=file_get_contents('php://input'); $d=json_decode($raw,true); return is_array($d)?$d:[]; }
function out($data,$code=200){ http_response_code($code); echo json_encode($data,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE); exit; }
function local_store_path(){ return __DIR__.'/data/login_records.json'; }
function ensure_local_store(){
  $dir=__DIR__.'/data';
  if(!is_dir($dir)) @mkdir($dir,0755,true);
  $file=local_store_path();
  if(!file_exists($file)) @file_put_contents($file,'[]',LOCK_EX);
}
function local_records_read(){
  ensure_local_store();
  $raw=@file_get_contents(local_store_path());
  $rows=json_decode($raw?:'[]',true);
  return is_array($rows)?$rows:[];
}
function local_records_write($rows){
  ensure_local_store();
  @file_put_contents(local_store_path(),json_encode(array_values($rows),JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE),LOCK_EX);
}
function record_local($name,$email,$provider,$date=null){
  $rows=local_records_read();
  $rows[]=['name'=>(string)$name,'email'=>(string)$email,'provider'=>(string)$provider,'date'=>$date ?: date('c')];
  // Keep only the most recent 2000 records.
  if(count($rows)>2000) $rows=array_slice($rows,-2000);
  local_records_write($rows);
}
function db(){
  static $pdo=null; if($pdo)return $pdo;
  try{
    $pdo=new PDO('mysql:host='.DB_HOST.';port=3306;dbname='.DB_NAME.';charset=utf8mb4',DB_USER,DB_PASS,[
      PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,
      PDO::ATTR_EMULATE_PREPARES=>false
    ]);
    // Keep the few tables needed by authentication and admin data available even
    // when the user imported the ZIP before importing database/schema.sql.
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(200) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id), UNIQUE KEY uq_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS login_records (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(200) NOT NULL DEFAULT '',
      email VARCHAR(255) NOT NULL DEFAULT '',
      provider VARCHAR(50) NOT NULL DEFAULT 'Buyer',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS products (
      id VARCHAR(100) NOT NULL,
      name VARCHAR(200) NOT NULL,
      price_usd DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      category VARCHAR(100) NOT NULL DEFAULT '',
      tag VARCHAR(60) NOT NULL DEFAULT '',
      stock INT NOT NULL DEFAULT 0,
      rating DECIMAL(3,2) NOT NULL DEFAULT 0.00,
      reviews INT NOT NULL DEFAULT 0,
      image_url TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS orders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_number VARCHAR(50) NOT NULL,
      items_json LONGTEXT NOT NULL,
      buyer_json LONGTEXT NOT NULL,
      method VARCHAR(50) NOT NULL DEFAULT 'bank',
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id), UNIQUE KEY uq_order_number (order_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    return $pdo;
  }catch(Throwable $e){ out(['error'=>'Database connection failed. Check backend/config.php and make sure the MySQL database exists on InfinityFree.'],500); }
}
function token(){ $h=$_SERVER['HTTP_AUTHORIZATION']??''; if(preg_match('/Bearer\s+(.+)/i',$h,$m))return $m[1]; return ''; }
function require_admin(){
  $t=token(); if(!$t)out(['error'=>'Missing admin token'],401);
  try{
    $payload=explode('.',$t)[0]??'';
    $p=json_decode(base64_decode(strtr($payload,'-_','+/')),true);
    $exp=(int)($p['exp']??0); $sig=$p['sig']??''; $email=$p['email']??'';
    $expected=hash_hmac('sha256',($p['email']??'').'|'.($p['exp']??0),ADMIN_PASSWORD_HASH);
    if($exp<time()||!hash_equals($expected,$sig)||$email!==ADMIN_EMAIL)throw new Exception();
  }catch(Throwable $e){out(['error'=>'Invalid or expired admin session'],401);}
}
function issue_token(){ $exp=time()+43200; $payload=['email'=>ADMIN_EMAIL,'exp'=>$exp,'sig'=>hash_hmac('sha256',ADMIN_EMAIL.'|'.$exp,ADMIN_PASSWORD_HASH)]; return rtrim(strtr(base64_encode(json_encode($payload)),'+/','-_'),'='); }
function http_json_get($url){
  if(function_exists('curl_init')){
    $ch=curl_init($url); curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>8,CURLOPT_FOLLOWLOCATION=>true,CURLOPT_SSL_VERIFYPEER=>true]); $raw=curl_exec($ch); curl_close($ch); return $raw;
  }
  $ctx=stream_context_create(['http'=>['timeout'=>8]]); return @file_get_contents($url,false,$ctx);
}
function record_server_login($name,$email,$provider){
  $now=date('Y-m-d H:i:s');
  try{ $st=db()->prepare('INSERT INTO login_records(name,email,provider) VALUES(?,?,?)'); $st->execute([substr((string)$name,0,200),substr((string)$email,0,255),substr((string)$provider,0,50)]); }
  catch(Throwable $e){ /* local fallback below */ }
  // The JSON mirror makes the admin Users tab resilient when MySQL is slow or the
  // account was imported without the optional login_records table.
  record_local(substr((string)$name,0,200),substr((string)$email,0,255),substr((string)$provider,0,50),date('c'));
  return $now;
}

$route=trim($_GET['route']??'','/'); $method=$_SERVER['REQUEST_METHOD'];
if($route==='health' && $method==='GET') out(['ok'=>true]);
if($route==='config' && $method==='GET') out(['googleClientId'=>GOOGLE_CLIENT_ID]);

if($route==='admin/login' && $method==='POST'){
  $d=json_input(); $email=strtolower(trim($d['email']??'')); $password=(string)($d['pin']??$d['password']??'');
  if($email!==strtolower(ADMIN_EMAIL)||!password_verify($password,ADMIN_PASSWORD_HASH))out(['error'=>'Invalid admin credentials'],401);
  out(['token'=>issue_token()]);
}

if($route==='products' && $method==='GET'){
  $rows=db()->query('SELECT id,name,price_usd,category,tag,stock,rating,reviews,image_url FROM products ORDER BY created_at ASC')->fetchAll(); out($rows);
}
if($route==='products/sync' && $method==='POST'){
  require_admin(); $d=json_input(); if(!isset($d['products'])||!is_array($d['products']))out(['error'=>'products must be an array'],400); $pdo=db(); $pdo->beginTransaction();
  try{
    $pdo->exec('DELETE FROM products');
    $st=$pdo->prepare('INSERT INTO products(id,name,price_usd,category,tag,stock,rating,reviews,image_url) VALUES(?,?,?,?,?,?,?,?,?)');
    foreach($d['products'] as $p){$st->execute([(string)($p['id']??''),substr((string)($p['name']??''),0,200),(float)($p['price']??0),substr((string)($p['category']??''),0,100),substr((string)($p['tag']??''),0,60),(int)($p['stock']??0),(float)($p['rating']??0),(int)($p['reviews']??0),(string)($p['image']??'')]);}
    $pdo->commit(); out(['ok'=>true,'count'=>count($d['products'])]);
  }catch(Throwable $e){$pdo->rollBack();out(['error'=>'Product sync failed'],500);}
}

if($route==='auth/signup' && $method==='POST'){
  $d=json_input(); $name=trim((string)($d['name']??''));$email=strtolower(trim((string)($d['email']??'')));$password=(string)($d['password']??'');
  if($name===''||!filter_var($email,FILTER_VALIDATE_EMAIL)||strlen($password)<6)out(['error'=>'Please provide a valid name, email and a password of at least 6 characters.'],400);
  $pdo=db(); $st=$pdo->prepare('SELECT id FROM users WHERE email=? LIMIT 1');$st->execute([$email]);if($st->fetch())out(['error'=>'An account with this email already exists.'],409);
  $st=$pdo->prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)');$st->execute([$name,$email,password_hash($password,PASSWORD_DEFAULT)]);
  record_server_login($name,$email,'Sign Up');
  out(['user'=>['name'=>$name,'email'=>$email]]);
}
if($route==='auth/login' && $method==='POST'){
  $d=json_input();$email=strtolower(trim((string)($d['email']??'')));$password=(string)($d['password']??'');$st=db()->prepare('SELECT name,email,password_hash FROM users WHERE email=? LIMIT 1');$st->execute([$email]);$u=$st->fetch();if(!$u||!password_verify($password,$u['password_hash']))out(['error'=>'Incorrect email or password.'],401); record_server_login($u['name'],$u['email'],'Buyer'); out(['user'=>['name'=>$u['name'],'email'=>$u['email']]]);
}
if($route==='auth/forgot-password' && $method==='POST') out(['message'=>'If that email exists, password-reset instructions are available.']);

if($route==='login-records' && $method==='GET'){
  require_admin();
  $rows=[];
  try{ $rows=db()->query('SELECT name,email,provider,created_at AS date FROM login_records ORDER BY id DESC LIMIT 2000')->fetchAll(); }catch(Throwable $e){}
  $local=local_records_read();
  foreach(array_reverse($local) as $r){ $rows[]=['name'=>$r['name']??'','email'=>$r['email']??'','provider'=>$r['provider']??'Buyer','date'=>$r['date']??'']; }
  $seen=[]; $merged=[];
  foreach($rows as $r){ $key=strtolower(($r['email']??'').'|'.($r['provider']??'').'|'.($r['date']??'')); if(isset($seen[$key]))continue; $seen[$key]=1; $merged[]=$r; }
  usort($merged,function($a,$b){return strcmp((string)($b['date']??''),(string)($a['date']??''));});
  out(array_slice($merged,0,2000));
}
if($route==='login-records' && $method==='DELETE'){
  require_admin();
  try{db()->exec('DELETE FROM login_records');}catch(Throwable $e){}
  local_records_write([]); out(['ok'=>true]);
}

if($route==='orders' && $method==='POST'){
  $d=json_input(); if(empty($d['items'])||empty($d['buyer']['name'])||empty($d['buyer']['phone']))out(['error'=>'Missing order details'],400);
  $pdo=db(); $n='GZ-'.(100000+(int)$pdo->query('SELECT COUNT(*) FROM orders')->fetchColumn()+1);
  $st=$pdo->prepare('INSERT INTO orders(order_number,items_json,buyer_json,method,status) VALUES(?,?,?,?,?)');$st->execute([$n,json_encode($d['items']),json_encode($d['buyer']),$d['method']??'bank','pending']);out(['orderNumber'=>$n]);
}
if($route==='orders' && $method==='GET'){
  require_admin();$rows=db()->query('SELECT * FROM orders ORDER BY id DESC')->fetchAll();
  foreach($rows as &$r){$r['items']=json_decode($r['items_json'],true);$r['buyer']=json_decode($r['buyer_json'],true);unset($r['items_json'],$r['buyer_json']);}
  out($rows);
}
if($route==='orders/status' && $method==='POST'){
  require_admin();
  $d=json_input(); $orderNumber=trim((string)($d['orderNumber']??'')); $status=trim((string)($d['status']??''));
  $allowed=['pending','confirmed','processing','shipped','out_for_delivery','delivered','cancelled'];
  if($orderNumber===''||!in_array($status,$allowed,true)) out(['error'=>'Invalid order number or status'],400);
  $st=db()->prepare('UPDATE orders SET status=? WHERE order_number=?'); $st->execute([$status,$orderNumber]);
  if($st->rowCount()<1) out(['error'=>'Order not found'],404);
  out(['ok'=>true,'orderNumber'=>$orderNumber,'status'=>$status]);
}

if($route==='auth/google' && $method==='POST'){
  $d=json_input();$cred=(string)($d['credential']??''); if(!$cred)out(['error'=>'Missing Google credential'],400); if(!GOOGLE_CLIENT_ID)out(['error'=>'Google Login is not configured. Add the Google Client ID in backend/config.php.'],501);
  $raw=http_json_get('https://oauth2.googleapis.com/tokeninfo?id_token='.rawurlencode($cred));
  $p=$raw?json_decode($raw,true):null;
  if(!$p||($p['aud']??'')!==GOOGLE_CLIENT_ID||empty($p['email']))out(['error'=>'Invalid Google credential'],401);
  $name=$p['name']??$p['email']; $email=strtolower((string)$p['email']);
  try{
    $pdo=db(); $st=$pdo->prepare('SELECT id FROM users WHERE email=? LIMIT 1'); $st->execute([$email]); $existing=$st->fetch();
    if($existing){ $up=$pdo->prepare('UPDATE users SET name=? WHERE id=?'); $up->execute([substr((string)$name,0,200),(int)$existing['id']]); }
    else{ $secret=password_hash(bin2hex(random_bytes(24)),PASSWORD_DEFAULT); $ins=$pdo->prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)'); $ins->execute([substr((string)$name,0,200),$email,$secret]); }
  }catch(Throwable $e){ /* login_records mirror still keeps admin visibility */ }
  record_server_login($name,$email,'Google');
  out(['email'=>$email,'name'=>$name,'picture'=>$p['picture']??'','emailVerified'=>($p['email_verified']??'false')==='true']);
}
if($route==='stripe/create-checkout-session' && $method==='POST') out(['error'=>'Stripe checkout is not enabled in the InfinityFree build. Use Bank Transfer or add a separate payment gateway.'],501);
if($route==='jazzcash/initiate' && $method==='POST') out(['error'=>'JazzCash requires merchant credentials and signed gateway integration.'],501);
out(['error'=>'Endpoint not found'],404);
?>
