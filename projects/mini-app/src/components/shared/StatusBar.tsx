interface StatusBarProps {
  message: string;
}

export function StatusBar({ message }: StatusBarProps) {
  if (!message) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 text-sm text-[#B3B3B3] text-center bg-[#282828] py-2 rounded-lg">
      {message}
    </div>
  );
}
