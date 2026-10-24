-- Árvore mercadológica no banco de produtos: Segmento › Departamento › Categoria › Subcategoria › Tipo
ALTER TABLE catalog ADD COLUMN segment TEXT;
ALTER TABLE catalog ADD COLUMN department TEXT;
ALTER TABLE catalog ADD COLUMN family TEXT;
