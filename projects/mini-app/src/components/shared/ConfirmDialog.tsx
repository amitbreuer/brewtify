export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor?: 'green' | 'red';
  onConfirm: () => void;
}

interface ConfirmDialogProps {
  dialog: ConfirmDialogData;
  onCancel: () => void;
}

export function ConfirmDialog({ dialog, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[#282828] rounded-2xl p-5 w-full max-w-xs flex flex-col gap-4">
        <h3 className="text-white font-semibold text-base">{dialog.title}</h3>
        <p className="text-[#B3B3B3] text-sm">{dialog.message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 bg-[#181818] text-white font-medium rounded-full text-sm"
          >
            Cancel
          </button>
          <button
            onClick={dialog.onConfirm}
            className={`flex-1 py-2.5 font-bold rounded-full text-sm ${
              dialog.confirmColor === 'red'
                ? 'bg-red-500 hover:bg-red-400 text-white'
                : 'bg-[#1DB954] hover:bg-[#1ED760] text-black'
            }`}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
