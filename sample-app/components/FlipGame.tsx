import { useWriteContract } from 'wagmi';
import { parseEther } from 'viem';

export function FlipGame() {
  const { writeContract } = useWriteContract();

  const handleFlip = () => {
    writeContract({
      address: '0x1234567890123456789012345678901234567890',
      abi: [{
        name: 'flip',
        type: 'function',
        stateMutability: 'payable',
        inputs: [{ name: 'choice', type: 'uint8' }],
        outputs: [],
      }],
      functionName: 'flip',
      args: [1], // 1 for heads
      value: parseEther('0.01'),
    });
  };

  return (
    <div>
      <button onClick={handleFlip}>Flip Coin (Onchain)</button>
    </div>
  );
}
