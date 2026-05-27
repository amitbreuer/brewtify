import { useEffect, useState } from 'react';
import type { UserProfile } from '../lib/types';
import { fetchProfile } from '../lib/api';
import { LoadingState, ErrorState } from './shared';

interface ProfileProps {
  onProfileLoaded: () => void;
}

export function Profile({ onProfileLoaded }: ProfileProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile()
      .then((p) => {
        setProfile(p);
        onProfileLoaded();
      })
      .catch((err) => setError(err.message));
  }, [onProfileLoaded]);

  if (error) {
    return <ErrorState message={error} />;
  }

  if (!profile) {
    return <LoadingState message="Loading profile..." />;
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
      <div>
        <div className="font-semibold text-white">{profile.display_name}</div>
        <div className="text-xs text-[#B3B3B3]">{profile.product} • {profile.country}</div>
      </div>
    </div>
  );
}
