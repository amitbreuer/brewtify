interface SkeletonProps {
  className?: string;
}

function Bone({ className = '' }: SkeletonProps) {
  return (
    <div className={`bg-[#282828] rounded animate-pulse ${className}`} />
  );
}

export function ProfileSkeleton() {
  return (
    <div className="flex items-center gap-3 p-4">
      <Bone className="w-10 h-10 rounded-full" />
      <div className="flex-1 flex flex-col gap-1.5">
        <Bone className="h-4 w-28" />
        <Bone className="h-3 w-20" />
      </div>
      <Bone className="h-6 w-16 rounded-full" />
    </div>
  );
}

export function PlaylistListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      <Bone className="h-10 w-full rounded-xl mb-2" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 bg-[#181818] rounded-lg">
          <Bone className="w-12 h-12 rounded" />
          <div className="flex-1 flex flex-col gap-1.5">
            <Bone className="h-4 w-3/4" />
            <Bone className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PlaylistDetailSkeleton() {
  return (
    <div className="min-h-screen bg-[#121212] text-white flex flex-col">
      {/* Header */}
      <div className="sticky top-0 bg-[#121212] border-b border-[#282828] z-10 p-4 flex items-center gap-3">
        <Bone className="w-6 h-6 rounded" />
        <Bone className="h-5 w-40 flex-1" />
        <Bone className="h-4 w-28" />
      </div>

      <div className="flex-1 p-4 flex flex-col gap-5">
        {/* Playlist info */}
        <div className="flex items-center gap-4">
          <Bone className="w-20 h-20 rounded-lg" />
          <div className="flex-1 flex flex-col gap-2">
            <Bone className="h-3 w-20" />
          </div>
          <Bone className="w-12 h-12 rounded-full" />
        </div>

        {/* Schedule info */}
        <div className="bg-[#181818] rounded-xl p-4 flex flex-col gap-2">
          <div className="flex justify-between">
            <Bone className="h-3 w-20" />
            <Bone className="h-3 w-16" />
          </div>
          <div className="flex justify-between">
            <Bone className="h-3 w-20" />
            <Bone className="h-3 w-16" />
          </div>
        </div>

        {/* Settings */}
        <div className="bg-[#181818] rounded-xl p-4 flex flex-col gap-4">
          <div className="flex justify-between">
            <Bone className="h-4 w-16" />
            <Bone className="h-4 w-10" />
          </div>
          <div className="flex flex-col gap-3">
            <Bone className="h-3 w-28" />
            <Bone className="h-8 w-full rounded-full" />
          </div>
          <div className="flex flex-col gap-3">
            <Bone className="h-3 w-12" />
            <Bone className="h-8 w-full rounded-full" />
          </div>
        </div>

        {/* Artists */}
        <div className="bg-[#181818] rounded-xl p-4 flex flex-col gap-3">
          <Bone className="h-4 w-20" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 bg-[#282828] rounded-xl">
              <Bone className="w-6 h-6 rounded-full" />
              <Bone className="h-3 flex-1 w-24" />
              <Bone className="h-3 w-8" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ArtistListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-2">
          <Bone className="w-12 h-12 rounded-full" />
          <div className="flex-1 flex flex-col gap-1.5">
            <Bone className="h-4 w-2/3" />
            <Bone className="h-3 w-1/3" />
          </div>
          <Bone className="h-7 w-20 rounded-full" />
          <Bone className="w-5 h-5 rounded-full" />
        </div>
      ))}
    </div>
  );
}
