interface WeightValidationProps {
  totalWeight: number;
  isValid: boolean;
}

export function WeightValidation({ totalWeight, isValid }: WeightValidationProps) {
  return (
    <div className={`text-xs text-center ${isValid ? 'text-[#1DB954]' : 'text-red-400'}`}>
      Total: {totalWeight}%
      {!isValid && ' - Must equal 100%'}
    </div>
  );
}
