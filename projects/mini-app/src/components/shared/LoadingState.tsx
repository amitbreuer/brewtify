interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = 'Loading...' }: LoadingStateProps) {
  return <div className="p-4 text-[#B3B3B3] text-center">{message}</div>;
}
