import { useEffect, useState } from 'react';
import type { UserProfile } from '../lib/types';
import { fetchProfile, logout } from '../lib/api';
import { ErrorState, ProfileSkeleton } from './shared';

interface ProfileProps {
  onProfileLoaded: () => void;
  onLogout: () => void;
}

export function Profile({ onProfileLoaded, onLogout }: ProfileProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    fetchProfile()
      .then((p) => {
        setProfile(p);
        onProfileLoaded();
      })
      .catch((err) => setError(err.message));
  }, [onProfileLoaded]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      onLogout();
    } catch {
      setLoggingOut(false);
    }
  };

  if (error) {
    return <ErrorState message={error} />;
  }

  if (!profile) {
    return <ProfileSkeleton />;
  }

  return (
    <div className="flex items-center gap-3 p-4">
      {profile.images[0] && (
        <img
          src={profile.images[0].url}
          alt={profile.display_name}
          className="w-10 h-10 rounded-full"
        />
      )}
      <div className="flex-1">
        <div className="font-semibold text-white">{profile.display_name}</div>
        <div className="text-xs text-[#B3B3B3]">{profile.product} • {profile.country}</div>
      </div>
      <button
        onClick={handleLogout}
        disabled={loggingOut}
        className="text-xs text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
      >
        {loggingOut ? 'Logging out...' : 'Log Out'}
      </button>
    </div>
  );
}
