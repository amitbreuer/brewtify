ALTER TABLE party_rooms DROP COLUMN device_id;
UPDATE party_rooms SET blocked_reason='device_unavailable'
WHERE blocked_reason IN ('device_confirmation_required', 'device_changed', 'device_restricted');
UPDATE party_requests SET failure_code='device_unavailable'
WHERE failure_code IN ('device_confirmation_required', 'device_changed', 'device_restricted');
