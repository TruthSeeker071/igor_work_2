-- quiz_profiles was frozen at 0013 (backfilled into user_profiles, kept one
-- release as rollback). Verified before this drop: 37/37 rows in both tables,
-- zero emails missing from user_profiles, zero rows newer in quiz_profiles —
-- the table holds no unique data. user_profiles is the only profile store.
DROP TABLE IF EXISTS quiz_profiles;
