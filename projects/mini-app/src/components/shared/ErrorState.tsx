interface ErrorStateProps {
  message: string;
}

export function ErrorState({ message }: ErrorStateProps) {
  return <div className="p-4 text-red-400 text-center">{message}</div>;
}
