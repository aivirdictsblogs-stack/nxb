INSERT OR IGNORE INTO permissions (id, description) VALUES
('products.manage','Manage products, plans, categories'),('inventory.manage','Manage inventory'),
('orders.manage','Manage orders'),('deliveries.manage','Deliver orders'),
('deposits.review','Approve/reject deposits'),('wallets.adjust','Adjust wallets'),
('refunds.manage','Issue refunds'),('customers.manage','Manage customers'),
('tickets.manage','Manage support tickets'),('content.manage','Banners and content'),
('coupons.manage','Manage coupons'),('reports.view','View reports'),
('audit.view','View audit logs'),('settings.manage','Website and security settings'),
('payments.manage','Payment methods and integrations'),('staff.manage','Manage staff and roles');
INSERT OR IGNORE INTO roles (id,name,description) VALUES
('super_admin','Super Admin','Full access'),('order_manager','Order Manager','Orders, delivery, inventory'),
('finance_manager','Finance Manager','Deposits, wallets, refunds, reports'),
('support_agent','Support Agent','Tickets and customers'),('product_manager','Product Manager','Catalog, content, coupons');
INSERT OR IGNORE INTO role_permissions (role_id,permission_id) SELECT 'super_admin', id FROM permissions;
INSERT OR IGNORE INTO role_permissions (role_id,permission_id) VALUES
('order_manager','orders.manage'),('order_manager','deliveries.manage'),('order_manager','inventory.manage'),
('finance_manager','deposits.review'),('finance_manager','wallets.adjust'),('finance_manager','refunds.manage'),('finance_manager','reports.view'),
('support_agent','tickets.manage'),('support_agent','customers.manage'),
('product_manager','products.manage'),('product_manager','inventory.manage'),('product_manager','content.manage'),('product_manager','coupons.manage');
INSERT OR IGNORE INTO product_categories (id,name,slug,sort_order) VALUES
('cat-ai','AI Tools & AI Subscriptions','ai-tools',1),('cat-stream','Streaming Subscriptions','streaming',2),
('cat-soft','Software & Productivity','software',3),('cat-video','Video Editing Tools','video-editing',4),
('cat-design','Design & Graphics Tools','design-graphics',5),('cat-vpn','VPN & Privacy Tools','vpn-privacy',6),
('cat-social','Social Media Digital Services','social-media',7),('cat-accounts','Digital Accounts','digital-accounts',8),
('cat-web','Website & Hosting Products','website-hosting',9),('cat-other','Other Digital Products','other',10);
INSERT OR IGNORE INTO payment_methods (id,code,name,instructions,min_amount_minor,requires_proof,is_active,sort_order) VALUES
('pm-bank','bank_transfer','Bank Transfer','Set bank account details in Admin > Payment Methods.',10000,1,0,1),
('pm-ep','easypaisa','Easypaisa','Set Easypaisa account details in Admin > Payment Methods.',10000,1,0,2),
('pm-jc','jazzcash','JazzCash','Set JazzCash account details in Admin > Payment Methods.',10000,1,0,3),
('pm-pf','payfast','PayFast','Automatic gateway - not yet configured.',10000,0,0,4);
INSERT OR IGNORE INTO site_settings (key,value) VALUES
('site_name','Noorix Digital Lab'),('tagline','All-in-One Digital Solutions Under One Roof.'),
('whatsapp','03154429417'),('currency','PKR'),('timezone','Asia/Karachi');
INSERT OR IGNORE INTO products (id,category_id,name,slug,short_description,full_description,features,is_featured,is_trending,input_fields,delivery_type) VALUES
('p-netflix','cat-stream','Netflix Premium','netflix-premium','HD & Ultra HD streaming screen','Enjoy unlimited movies and shows.','["HD & Ultra HD","Multiple devices","Instant activation"]',1,1,'[{"key":"profile_name","label":"Preferred profile name","required":false}]','manual'),
('p-prime','cat-stream','Prime Video','prime-video','Prime Video subscription','Stream originals and movies.','["HD streaming","Originals"]',0,1,'[]','manual'),
('p-ytp','cat-stream','YouTube Premium','youtube-premium','Ad-free YouTube','Ad-free playback and background play.','["Ad-free","Background play"]',1,1,'[{"key":"email","label":"Your Google email","required":true}]','manual'),
('p-spotify','cat-stream','Spotify Premium','spotify-premium','Premium music','Ad-free music.','["Ad-free","Offline"]',0,1,'[]','manual'),
('p-chatgpt','cat-ai','ChatGPT Pro','chatgpt-pro','AI assistant subscription','Advanced AI assistant.','["Advanced models"]',1,0,'[{"key":"email","label":"Account email","required":true}]','manual'),
('p-canva','cat-design','Canva Pro','canva-pro','Design toolkit','Premium design tools.','["Premium templates"]',0,1,'[{"key":"email","label":"Canva email","required":true}]','manual');
INSERT OR IGNORE INTO product_plans (id,product_id,name,duration,price_minor,compare_at_minor,stock,sort_order) VALUES
('pl-netflix-1','p-netflix','1 Month','30 days',29900,49900,NULL,1),
('pl-prime-1','p-prime','1 Month','30 days',29900,NULL,NULL,1),
('pl-ytp-1','p-ytp','1 Month','30 days',29900,NULL,NULL,1),
('pl-spotify-1','p-spotify','1 Month','30 days',29900,NULL,NULL,1),
('pl-chatgpt-1','p-chatgpt','1 Month','30 days',199900,NULL,NULL,1),
('pl-canva-1','p-canva','1 Month','30 days',49900,NULL,NULL,1);
