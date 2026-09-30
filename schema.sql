-- InfinityFree database schema. The PHP backend can also auto-create these core tables.
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS login_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(200) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  provider VARCHAR(50) NOT NULL DEFAULT 'Buyer',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_number VARCHAR(50) NOT NULL,
  items_json LONGTEXT NOT NULL,
  buyer_json LONGTEXT NOT NULL,
  method VARCHAR(50) NOT NULL DEFAULT 'bank',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_number (order_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO products (id,name,price_usd,category,tag,stock,rating,reviews,image_url) VALUES
('p1','Signature Noir Perfume',75.00,'Fragrance','NEW DROP',30,4.80,126,'https://images.unsplash.com/photo-1587017539504-67cfbddac569?w=600&h=750&fit=crop'),
('p2','Classic Slim Jeans',68.00,'Bottoms','',40,4.60,214,'https://images.unsplash.com/photo-1584370848010-d7fe6bc767ec?w=600&h=750&fit=crop'),
('p3','Baggy Cargo Jeans',89.00,'Bottoms','LIMITED',12,4.90,58,'https://images.unsplash.com/photo-1490578474895-699cd4e2cf59?w=600&h=750&fit=crop'),
('p4','Oversized Graphic Tee',42.00,'Tops','NEW DROP',55,4.70,301,'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=600&h=750&fit=crop'),
('p5','Street Chain Necklace',28.00,'Accessories','',35,4.50,89,'https://images.unsplash.com/photo-1552346154-21d32810aba3?w=600&h=750&fit=crop'),
('p6','Bucket Hat',32.00,'Accessories','',38,4.40,112,'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=600&h=750&fit=crop'),
('p7','Aviator Sunglasses',55.00,'Accessories','',22,4.70,73,'https://images.unsplash.com/photo-1560243563-062bfc001d68?w=600&h=750&fit=crop'),
('p8','Leather Strap Wallet',45.00,'Accessories','RESTOCKED',18,4.80,95,'https://images.unsplash.com/photo-1550246140-29f40b909e5a?w=600&h=750&fit=crop')
ON DUPLICATE KEY UPDATE
  name=VALUES(name), price_usd=VALUES(price_usd), category=VALUES(category),
  tag=VALUES(tag), stock=VALUES(stock), rating=VALUES(rating),
  reviews=VALUES(reviews), image_url=VALUES(image_url);
