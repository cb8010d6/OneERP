UPDATE "Role"
SET "permissions" = array_append("permissions", 'production:*')
WHERE "name" = 'Admin'
  AND NOT ('production:*' = ANY("permissions"));

UPDATE "Role"
SET "permissions" = array_append("permissions", 'production:read')
WHERE "name" IN ('Sales', 'Readonly')
  AND NOT ('production:read' = ANY("permissions"));

UPDATE "Role"
SET "permissions" = array_append("permissions", 'production:read')
WHERE "name" = 'Warehouse'
  AND NOT ('production:read' = ANY("permissions"));

UPDATE "Role"
SET "permissions" = array_append("permissions", 'production:post')
WHERE "name" = 'Warehouse'
  AND NOT ('production:post' = ANY("permissions"));
