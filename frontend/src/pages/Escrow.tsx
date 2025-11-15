import React, { useMemo, useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { decodeEventLog } from 'viem'
import { erc20Abi, timeEscrowAbi } from '../lib/abi'
import { CONTRACTS } from '../lib/contracts'

function formatAmount(v?: bigint) {
  if (!v) return '0'
  return (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 6 })
}

export default function EscrowPage() {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const [provider, setProvider] = useState('')
  const [amount, setAmount] = useState('1')
  const [escrowId, setEscrowId] = useState<string>('')
  const [extractingFromTx, setExtractingFromTx] = useState(false)

  const tokenAddress = CONTRACTS.sepolia.timeToken as `0x${string}`
  const escrowAddress = CONTRACTS.sepolia.timeEscrow as `0x${string}`

  const amountWei = useMemo(() => {
    try { return BigInt(Math.floor(Number(amount || '0') * 1e18)) } catch { return 0n }
  }, [amount])

  const escrowIdBigInt = useMemo(() => {
    try { return escrowId ? BigInt(escrowId) : undefined } catch { return undefined }
  }, [escrowId])

  // Try to read escrow details using getEscrow function (if available in contract)
  const { data: escrowDataFromGetEscrow, isLoading: loadingGetEscrow, error: getEscrowError } = useReadContract({
    abi: timeEscrowAbi,
    address: escrowAddress,
    functionName: 'getEscrow',
    args: escrowIdBigInt ? [escrowIdBigInt] : undefined,
    query: { enabled: !!escrowIdBigInt, retry: 1 },
  })

  // Fallback: Use public mapping getter (escrows mapping is public, so Solidity auto-generates a getter)
  // This should always work if the contract is deployed, even if getEscrow doesn't exist
  const { data: escrowDataFromMapping, isLoading: loadingMapping, error: mappingError } = useReadContract({
    abi: timeEscrowAbi,
    address: escrowAddress,
    functionName: 'escrows',
    args: escrowIdBigInt ? [escrowIdBigInt] : undefined,
    query: { enabled: !!escrowIdBigInt, retry: 1 },
  })

  // Use whichever works (prefer getEscrow if available, fallback to mapping)
  const escrowData = escrowDataFromGetEscrow || escrowDataFromMapping
  const loadingEscrow = loadingGetEscrow || loadingMapping
  // Only show error if both fail
  const escrowError = (!escrowDataFromGetEscrow && getEscrowError) && (!escrowDataFromMapping && mappingError) ? (mappingError || getEscrowError) : null

  const escrowRequester = escrowData?.[0]
  const escrowProvider = escrowData?.[1]
  const escrowAmount = escrowData?.[2]
  const escrowRequesterConfirmed = escrowData?.[3]
  const escrowProviderConfirmed = escrowData?.[4]
  const escrowActive = escrowData?.[5]

  const { data: allowance } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: 'allowance',
    args: address ? [address, escrowAddress] : undefined,
    query: { enabled: !!address },
  })

  const { data: balance } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract()
  const { isLoading: waiting, data: receipt, error: receiptError } = useWaitForTransactionReceipt({ hash })
  
  // Show transaction errors
  React.useEffect(() => {
    if (writeError) {
      console.error('Transaction error:', writeError)
      const errorMsg = writeError.message || String(writeError)
      if (errorMsg.includes('user rejected') || errorMsg.includes('User denied') || errorMsg.includes('rejected')) {
        // User cancelled, don't show alert
        console.log('User rejected transaction')
        return
      }
      // Check for gas estimation errors
      if (errorMsg.includes('gas') || errorMsg.includes('revert') || errorMsg.includes('execution reverted')) {
        alert(`Transaction will fail: ${errorMsg}\n\nThis usually means:\n- You're not authorized (not a party, already confirmed, etc.)\n- The escrow is inactive\n- Insufficient balance or allowance\n\nCheck the console for details.`)
      } else {
        alert(`Transaction failed: ${errorMsg}`)
      }
    }
    if (receiptError) {
      console.error('Receipt error:', receiptError)
      alert(`Transaction receipt error: ${receiptError.message || String(receiptError)}`)
    }
  }, [writeError, receiptError])
  
  // Log successful transactions
  React.useEffect(() => {
    if (receipt && hash) {
      console.log('Transaction successful:', { hash, receipt })
      // If this was a createEscrow transaction, the tokens should now be in the escrow contract
      if (receipt.logs && receipt.logs.length > 0) {
        console.log('Transaction logs:', receipt.logs)
      }
    }
  }, [receipt, hash])
  
  // Extract escrow ID from transaction receipt
  React.useEffect(() => {
    if (receipt && hash) {
      try {
        // Find EscrowCreated event in logs
        for (const log of receipt.logs) {
          try {
            // Decode the event using the ABI
            const decoded = decodeEventLog({
              abi: timeEscrowAbi,
              data: log.data,
              topics: log.topics,
            })
            
            if (decoded.eventName === 'EscrowCreated') {
              const escrowIdFromEvent = decoded.args.escrowId as bigint
              console.log('Extracted escrow ID from event:', escrowIdFromEvent.toString())
              setEscrowId(escrowIdFromEvent.toString())
              break
            }
          } catch (e) {
            // Not an EscrowCreated event, continue
            continue
          }
        }
      } catch (error) {
        console.error('Error extracting escrow ID:', error)
      }
    }
  }, [receipt, hash])
  
  // Helper function to extract escrow ID from transaction hash
  const extractEscrowIdFromTxHash = async (txHash: string) => {
    if (!publicClient) {
      alert('Unable to connect to blockchain. Please enter escrow ID manually.')
      return
    }
    
    setExtractingFromTx(true)
    try {
      // Remove 0x prefix if present
      const hash = txHash.startsWith('0x') ? txHash : `0x${txHash}`
      
      // Get transaction receipt
      const receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` })
      
      // Find EscrowCreated event
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: timeEscrowAbi,
            data: log.data,
            topics: log.topics,
          })
          
          if (decoded.eventName === 'EscrowCreated') {
            const escrowIdFromEvent = decoded.args.escrowId as bigint
            setEscrowId(escrowIdFromEvent.toString())
            alert(`Escrow ID extracted: ${escrowIdFromEvent.toString()}`)
            setExtractingFromTx(false)
            return
          }
        } catch (e) {
          continue
        }
      }
      
      alert('Could not find EscrowCreated event in this transaction. Make sure this is a createEscrow transaction.')
    } catch (error) {
      console.error('Error extracting escrow ID from tx hash:', error)
      alert(`Error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setExtractingFromTx(false)
    }
  }

  // Check if user is a party to the escrow
  const isPartyToEscrow = useMemo(() => {
    if (!address || !escrowRequester || !escrowProvider) return false
    const addr = address.toLowerCase()
    return addr === (escrowRequester as string).toLowerCase() || addr === (escrowProvider as string).toLowerCase()
  }, [address, escrowRequester, escrowProvider])

  // Check if already confirmed
  const isAlreadyConfirmed = useMemo(() => {
    if (!address || !escrowRequester || !escrowProvider) return false
    const addr = address.toLowerCase()
    const isRequester = addr === (escrowRequester as string).toLowerCase()
    const isProvider = addr === (escrowProvider as string).toLowerCase()
    
    if (isRequester) return escrowRequesterConfirmed === true
    if (isProvider) return escrowProviderConfirmed === true
    return false
  }, [address, escrowRequester, escrowProvider, escrowRequesterConfirmed, escrowProviderConfirmed])

  const needsApprove = (allowance ?? 0n) < (amountWei ?? 0n)

  const onApprove = () => {
    if (!amountWei || amountWei === 0n) {
      alert('Please enter a valid amount greater than 0')
      return
    }
    if (!address) {
      alert('Please connect your wallet')
      return
    }
    if (balance !== undefined && (balance ?? 0n) < amountWei) {
      alert(`Insufficient balance. You have ${formatAmount(balance)} TTK, but need ${formatAmount(amountWei)} TTK.`)
      return
    }
    try {
      writeContract({ 
        abi: erc20Abi, 
        address: tokenAddress, 
        functionName: 'approve', 
        args: [escrowAddress, amountWei] 
      })
    } catch (error) {
      console.error('Approve error:', error)
      alert(`Failed to approve: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const onCreate = () => {
    if (!amountWei || !provider) {
      alert('Please enter provider address and amount')
      return
    }
    
    // Validate provider address
    if (!provider.startsWith('0x') || provider.length !== 42) {
      alert('Invalid provider address. Must be a valid Ethereum address (0x...)')
      return
    }
    
    // Check allowance
    if (needsApprove) {
      alert('Please approve tokens first before creating escrow')
      return
    }
    
    // Check balance
    if (balance !== undefined && (balance ?? 0n) < amountWei) {
      alert(`Insufficient balance. You have ${formatAmount(balance)} TTK, but need ${formatAmount(amountWei)} TTK.`)
      return
    }
    
    console.log('Creating escrow:', { provider, amountWei, allowance, balance })
    
    try {
      writeContract({ 
        abi: timeEscrowAbi, 
        address: escrowAddress, 
        functionName: 'createEscrow', 
        args: [provider as `0x${string}`, amountWei] 
      })
    } catch (error) {
      console.error('Create escrow error:', error)
      alert(`Failed to create escrow: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const onConfirm = () => {
    if (!escrowId || !escrowIdBigInt) {
      alert('Please enter a valid escrow ID')
      return
    }
    
    if (!address) {
      alert('Please connect your wallet')
      return
    }
    
    console.log('Confirm escrow:', { 
      escrowId: escrowIdBigInt, 
      address, 
      escrowRequester, 
      escrowProvider, 
      isPartyToEscrow, 
      escrowActive, 
      isAlreadyConfirmed 
    })
    
    // If we have escrow data, validate before submitting
    if (escrowRequester && escrowProvider) {
      if (!isPartyToEscrow) {
        alert(`You are not a party to this escrow.\nRequester: ${shorten(escrowRequester as string)}\nProvider: ${shorten(escrowProvider as string)}\nYour address: ${shorten(address || '')}`)
        return
      }
      
      if (!escrowActive) {
        alert('This escrow is no longer active. It may have been completed or cancelled.')
        return
      }
      
      if (isAlreadyConfirmed) {
        alert('You have already confirmed this escrow.')
        return
      }
    } else {
      // If we can't load escrow data, warn user but allow them to try
      const proceed = confirm('Could not load escrow details. The transaction may fail if:\n- You are not a party to this escrow\n- The escrow is already inactive\n- You have already confirmed\n\nDo you want to proceed anyway?')
      if (!proceed) return
    }
    
    try {
      console.log('Calling writeContract for confirm...')
      writeContract({ 
        abi: timeEscrowAbi, 
        address: escrowAddress, 
        functionName: 'confirm', 
        args: [escrowIdBigInt] 
      })
      console.log('writeContract called successfully')
    } catch (error) {
      console.error('Confirm error:', error)
      alert(`Failed to confirm escrow: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const onCancel = () => {
    if (!escrowId || !escrowIdBigInt) {
      alert('Please enter a valid escrow ID')
      return
    }
    
    if (!address) {
      alert('Please connect your wallet')
      return
    }
    
    // Validate cancel conditions
    if (escrowRequester && escrowProvider) {
      // Check if user is the requester
      const addr = address.toLowerCase()
      const isRequester = addr === (escrowRequester as string).toLowerCase()
      
      if (!isRequester) {
        alert(`Only the requester can cancel this escrow.\nRequester: ${shorten(escrowRequester as string)}\nYour address: ${shorten(address)}`)
        return
      }
      
      if (escrowProviderConfirmed) {
        alert('Cannot cancel: Provider has already confirmed. Escrow must be completed or cancelled by provider.')
        return
      }
      
      if (!escrowActive) {
        alert('This escrow is already inactive (completed or cancelled).')
        return
      }
    } else {
      // If we can't load escrow data, warn user
      const proceed = confirm('Could not load escrow details. Cancel will fail if:\n- You are not the requester\n- Provider has already confirmed\n- Escrow is already inactive\n\nDo you want to proceed anyway?')
      if (!proceed) return
    }
    
    try {
      console.log('Calling writeContract for cancel...')
      writeContract({ 
        abi: timeEscrowAbi, 
        address: escrowAddress, 
        functionName: 'cancel', 
        args: [escrowIdBigInt] 
      })
    } catch (error) {
      console.error('Cancel error:', error)
      alert(`Failed to cancel escrow: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Escrow</h2>
      {!isConnected ? (
        <div className="card">Please connect your wallet.</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card space-y-3">
            <div className="text-sm text-neutral-400">Create Escrow</div>
            <label className="block text-sm">Provider address</label>
            <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="0x..." className="w-full bg-transparent border border-neutral-700 rounded px-3 py-2" />
            <label className="block text-sm">Amount (TTK)</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full bg-transparent border border-neutral-700 rounded px-3 py-2" />
            <div className="text-xs space-y-1">
              <div className="text-neutral-400">Balance: {formatAmount(balance)} TTK</div>
              <div className="text-neutral-400">Allowance: {formatAmount(allowance)} TTK</div>
              {balance !== undefined && amountWei > 0n && (balance ?? 0n) < amountWei && (
                <div className="text-red-400">⚠️ Insufficient balance</div>
              )}
            </div>
            {needsApprove ? (
              <button className="btn-primary" disabled={isPending || waiting} onClick={onApprove}>Approve</button>
            ) : (
              <button className="btn-primary" disabled={isPending || waiting} onClick={onCreate}>Create Escrow</button>
            )}
            {hash && (
              <div className="space-y-1">
                <div className="text-xs text-neutral-400 break-all">
                  Tx: <a 
                    href={`https://sepolia.etherscan.io/tx/${hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-400 hover:underline"
                  >
                    {hash.slice(0, 10)}...{hash.slice(-8)}
                  </a>
                </div>
                {receipt && (
                  <div className="text-xs text-green-400 space-y-1">
                    <div>✓ Transaction confirmed!</div>
                    {escrowId && (
                      <div>✓ Escrow ID automatically extracted: <strong>{escrowId}</strong></div>
                    )}
                    {!escrowId && (
                      <div>⚠️ Escrow ID not found. Check Etherscan logs or use the "Extract ID from Transaction Hash" button.</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card space-y-3">
            <div className="text-sm text-neutral-400">Confirm / Cancel</div>
            <label className="block text-sm">Escrow ID</label>
            <div className="space-y-2">
              <input 
                value={escrowId} 
                onChange={(e) => setEscrowId(e.target.value)} 
                className="w-full bg-transparent border border-neutral-700 rounded px-3 py-2" 
                placeholder="Enter escrow ID (e.g., 1, 2, 3...)" 
              />
              <div className="text-xs text-neutral-500 space-y-1">
                <div>💡 <strong>Escrow ID</strong> is a number (1, 2, 3...), NOT the transaction hash</div>
                <div>If you have a transaction hash, click the button below to extract the escrow ID:</div>
                <button
                  type="button"
                  onClick={() => {
                    const txHash = prompt('Enter transaction hash:')
                    if (txHash) extractEscrowIdFromTxHash(txHash)
                  }}
                  disabled={extractingFromTx}
                  className="text-xs px-2 py-1 bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-50"
                >
                  {extractingFromTx ? 'Extracting...' : 'Extract ID from Transaction Hash'}
                </button>
              </div>
            </div>
            
            {/* Escrow Status Info */}
            {escrowIdBigInt && (
              <div className="text-xs space-y-1 p-2 bg-neutral-800/50 rounded border border-neutral-700">
                {loadingEscrow ? (
                  <div className="text-neutral-500">Loading escrow details...</div>
                ) : escrowError ? (
                  <div className="space-y-2">
                    <div className="text-yellow-400">⚠️ Could not load escrow details</div>
                    <div className="text-neutral-400 text-xs">
                      Check escrow on Etherscan: <a 
                        href={`https://sepolia.etherscan.io/address/${escrowAddress}#readContract`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:underline"
                      >
                        View Contract
                      </a>
                    </div>
                    <div className="text-neutral-400 text-xs mt-2">
                      Enter escrow ID in the "escrows" function to verify details
                    </div>
                    <div className="text-yellow-300 text-xs mt-2 p-2 bg-yellow-900/20 rounded">
                      ⚠️ Warning: Without escrow details, the confirm transaction may fail if you're not a party or if the escrow is inactive.
                    </div>
                  </div>
                ) : escrowRequester && escrowProvider && escrowRequester !== '0x0000000000000000000000000000000000000000' ? (
                  <>
                    <div>Requester: {shorten(escrowRequester as string)}</div>
                    <div>Provider: {shorten(escrowProvider as string)}</div>
                    <div>Amount: {escrowAmount ? formatAmount(escrowAmount as bigint) : 'N/A'} TTK</div>
                    <div>Status: {escrowActive ? 'Active' : 'Inactive'}</div>
                    <div>Requester Confirmed: {escrowRequesterConfirmed ? 'Yes' : 'No'}</div>
                    <div>Provider Confirmed: {escrowProviderConfirmed ? 'Yes' : 'No'}</div>
                    {!isPartyToEscrow && (
                      <div className="text-yellow-400 mt-1">⚠️ You are not a party to this escrow</div>
                    )}
                    {isAlreadyConfirmed && (
                      <div className="text-yellow-400 mt-1">⚠️ You have already confirmed</div>
                    )}
                    {!escrowActive && (
                      <div className="text-red-400 mt-1">⚠️ Escrow is inactive (completed or cancelled)</div>
                    )}
                  </>
                ) : escrowRequester === '0x0000000000000000000000000000000000000000' || escrowProvider === '0x0000000000000000000000000000000000000000' ? (
                  <div className="space-y-2">
                    <div className="text-red-400">⚠️ Escrow not found or invalid ID</div>
                    <div className="text-neutral-400 text-xs">
                      This escrow ID doesn't exist. Make sure you're entering the correct number.
                      <br />
                      <br />
                      <strong>Remember:</strong> Escrow ID is a number (1, 2, 3...), NOT the transaction hash.
                      <br />
                      Use the "Extract ID from Transaction Hash" button if you only have the transaction hash.
                    </div>
                  </div>
                ) : (
                  <div className="text-neutral-500">Escrow not found or invalid ID</div>
                )}
              </div>
            )}
            
            {/* Info Box */}
            <div className="text-xs p-2 bg-blue-900/20 border border-blue-700/50 rounded">
              <div className="font-semibold text-blue-300 mb-1">How Escrow Works:</div>
              <div className="text-neutral-400 space-y-1">
                <div>1. Creating escrow = Tokens go to <strong>Escrow Contract</strong> (locked)</div>
                <div>2. Both parties confirm = Tokens released to <strong>Provider</strong></div>
                <div>3. Check transaction on Etherscan to see the <strong>EscrowCreated</strong> event for the escrow ID</div>
              </div>
            </div>
            
            <div className="flex gap-2">
              <button 
                className="btn-primary" 
                onClick={onConfirm} 
                disabled={isPending || waiting || (escrowRequester && escrowProvider && (!isPartyToEscrow || !escrowActive || isAlreadyConfirmed))}
              >
                Confirm
              </button>
              <button className="btn-primary" onClick={onCancel} disabled={isPending || waiting}>Cancel</button>
            </div>
            {hash && (
              <div className="text-xs text-neutral-400 break-all">
                Tx: <a 
                  href={`https://sepolia.etherscan.io/tx/${hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:underline"
                >
                  {hash.slice(0, 10)}...{hash.slice(-8)}
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function shorten(address?: string) {
  if (!address) return ''
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}


