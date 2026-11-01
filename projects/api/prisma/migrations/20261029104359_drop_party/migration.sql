-- Party feature removed; drop all of its tables (dependents first).
DROP TABLE IF EXISTS party_delivery_attempts;
DROP TABLE IF EXISTS party_jobs;
DROP TABLE IF EXISTS party_match_candidates;
DROP TABLE IF EXISTS party_requests;
DROP TABLE IF EXISTS party_memberships;
DROP TABLE IF EXISTS party_rooms;
DROP TABLE IF EXISTS party_host_sessions;
DROP TABLE IF EXISTS party_authorizations;
DROP TABLE IF EXISTS party_mini_app_sessions;
DROP TABLE IF EXISTS party_throttles;
