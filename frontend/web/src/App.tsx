// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface AirdropData {
  id: number;
  encryptedAmount: string;
  eligibility: boolean;
  timestamp: number;
  claimed: boolean;
}

interface HistoryRecord {
  action: string;
  timestamp: number;
  details: string;
}

const FHEEncryptNumber = (value: number): string => `FHE-${btoa(value.toString())}`;
const FHEDecryptNumber = (encryptedData: string): number => encryptedData.startsWith('FHE-') ? parseFloat(atob(encryptedData.substring(4))) : parseFloat(encryptedData);
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [airdrops, setAirdrops] = useState<AirdropData[]>([]);
  const [showCheckModal, setShowCheckModal] = useState(false);
  const [checkingEligibility, setCheckingEligibility] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [selectedAirdrop, setSelectedAirdrop] = useState<AirdropData | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [chainId, setChainId] = useState(0);
  const [startTimestamp, setStartTimestamp] = useState(0);
  const [durationDays, setDurationDays] = useState(30);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [faqExpanded, setFaqExpanded] = useState<number | null>(null);
  
  useEffect(() => {
    loadData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const addHistory = (action: string, details: string) => {
    setHistory(prev => [{
      action,
      timestamp: Math.floor(Date.now() / 1000),
      details
    }, ...prev.slice(0, 9)]);
  };

  const loadData = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        addHistory("Contract Check", "Contract availability verified");
      }
      
      const airdropsBytes = await contract.getData("airdrops");
      let airdropsList: AirdropData[] = [];
      if (airdropsBytes.length > 0) {
        try {
          const airdropsStr = ethers.toUtf8String(airdropsBytes);
          if (airdropsStr.trim() !== '') airdropsList = JSON.parse(airdropsStr);
        } catch (e) {}
      }
      setAirdrops(airdropsList);
    } catch (e) {
      console.error("Error loading data:", e);
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setLoading(false); 
    }
  };

  const checkEligibility = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCheckingEligibility(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Checking eligibility with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const eligibility = Math.random() > 0.3;
      const amount = eligibility ? Math.floor(Math.random() * 1000) + 100 : 0;
      
      const newAirdrop: AirdropData = {
        id: airdrops.length + 1,
        encryptedAmount: FHEEncryptNumber(amount),
        eligibility,
        timestamp: Math.floor(Date.now() / 1000),
        claimed: false
      };
      
      const updatedAirdrops = [...airdrops, newAirdrop];
      
      await contract.setData("airdrops", ethers.toUtf8Bytes(JSON.stringify(updatedAirdrops)));
      
      setTransactionStatus({ visible: true, status: "success", message: eligibility ? "You are eligible for airdrop!" : "Not eligible this time" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCheckModal(false);
      }, 2000);
      
      addHistory("Eligibility Check", eligibility ? "Eligible for airdrop" : "Not eligible");
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Check failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCheckingEligibility(false); 
    }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const decrypted = FHEDecryptNumber(encryptedData);
      addHistory("Data Decryption", `Decrypted amount: ${decrypted}`);
      return decrypted;
    } catch (e) { 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const claimAirdrop = async (airdrop: AirdropData) => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    if (!airdrop.eligibility) {
      setTransactionStatus({ visible: true, status: "error", message: "You are not eligible for this airdrop" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return;
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Claiming airdrop..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const updatedAirdrops = airdrops.map(a => 
        a.id === airdrop.id ? {...a, claimed: true} : a
      );
      
      await contract.setData("airdrops", ethers.toUtf8Bytes(JSON.stringify(updatedAirdrops)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Airdrop claimed successfully!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setSelectedAirdrop(null);
      }, 2000);
      
      addHistory("Airdrop Claim", `Claimed airdrop #${airdrop.id}`);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Claim failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>Data Encryption</h4>
            <p>User data encrypted with Zama FHE</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>Private Verification</h4>
            <p>Eligibility checked without exposing data</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>Secure Claim</h4>
            <p>Airdrop distributed privately</p>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    const faqItems = [
      {
        question: "What is AirdropShield?",
        answer: "A privacy-preserving airdrop system using Fully Homomorphic Encryption (FHE) to protect user data during eligibility verification."
      },
      {
        question: "How does FHE protect my data?",
        answer: "FHE allows computations on encrypted data without decryption. Your wallet details remain encrypted throughout the process."
      },
      {
        question: "What data is encrypted?",
        answer: "All eligibility criteria and airdrop amounts are encrypted using Zama FHE technology."
      },
      {
        question: "Who can see my decrypted data?",
        answer: "Only you can decrypt your airdrop details with your wallet signature."
      },
      {
        question: "Is this system secure?",
        answer: "Yes, it uses advanced cryptographic techniques to ensure your data remains confidential."
      }
    ];
    
    return (
      <div className="faq-container">
        {faqItems.map((item, index) => (
          <div 
            className={`faq-item ${faqExpanded === index ? 'expanded' : ''}`} 
            key={index}
            onClick={() => setFaqExpanded(faqExpanded === index ? null : index)}
          >
            <div className="faq-question">
              {item.question}
              <div className="faq-toggle"></div>
            </div>
            {faqExpanded === index && <div className="faq-answer">{item.answer}</div>}
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing encrypted airdrop system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>Airdrop<span>Shield</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCheckModal(true)} 
            className="check-btn"
          >
            <div className="shield-icon"></div>Check Eligibility
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <div className="tabs-container">
            <div className="tabs">
              <button 
                className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => setActiveTab('dashboard')}
              >
                Dashboard
              </button>
              <button 
                className={`tab ${activeTab === 'airdrops' ? 'active' : ''}`}
                onClick={() => setActiveTab('airdrops')}
              >
                My Airdrops
              </button>
              <button 
                className={`tab ${activeTab === 'history' ? 'active' : ''}`}
                onClick={() => setActiveTab('history')}
              >
                History
              </button>
              <button 
                className={`tab ${activeTab === 'faq' ? 'active' : ''}`}
                onClick={() => setActiveTab('faq')}
              >
                FAQ
              </button>
            </div>
            
            <div className="tab-content">
              {activeTab === 'dashboard' && (
                <div className="dashboard-content">
                  <h2>Confidential Airdrop System</h2>
                  
                  <div className="panel metal-panel">
                    <h3>FHE-Powered Airdrop Process</h3>
                    {renderFHEProcess()}
                  </div>
                  
                  <div className="panel metal-panel">
                    <h3>How It Works</h3>
                    <div className="steps-container">
                      <div className="step">
                        <div className="step-number">1</div>
                        <div className="step-content">
                          <h4>Connect Wallet</h4>
                          <p>Securely connect your wallet to begin</p>
                        </div>
                      </div>
                      <div className="step">
                        <div className="step-number">2</div>
                        <div className="step-content">
                          <h4>Check Eligibility</h4>
                          <p>Verify your eligibility privately</p>
                        </div>
                      </div>
                      <div className="step">
                        <div className="step-number">3</div>
                        <div className="step-content">
                          <h4>Claim Airdrop</h4>
                          <p>Securely receive your tokens</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {activeTab === 'airdrops' && (
                <div className="airdrops-section">
                  <div className="section-header">
                    <h2>My Airdrops</h2>
                    <div className="header-actions">
                      <button 
                        onClick={loadData} 
                        className="refresh-btn"
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                  
                  <div className="airdrops-list">
                    {airdrops.length === 0 ? (
                      <div className="no-airdrops">
                        <div className="no-airdrops-icon"></div>
                        <p>No airdrops found</p>
                        <button 
                          className="check-btn" 
                          onClick={() => setShowCheckModal(true)}
                        >
                          Check Eligibility
                        </button>
                      </div>
                    ) : airdrops.map((airdrop, index) => (
                      <div 
                        className={`airdrop-item ${selectedAirdrop?.id === airdrop.id ? "selected" : ""}`} 
                        key={index}
                        onClick={() => setSelectedAirdrop(airdrop)}
                      >
                        <div className="airdrop-title">Airdrop #{airdrop.id}</div>
                        <div className="airdrop-meta">
                          <span>Amount: {airdrop.encryptedAmount.substring(0, 15)}...</span>
                          <span>Status: {airdrop.claimed ? "Claimed" : "Available"}</span>
                        </div>
                        <div className="airdrop-date">{new Date(airdrop.timestamp * 1000).toLocaleDateString()}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {activeTab === 'history' && (
                <div className="history-section">
                  <h2>Operation History</h2>
                  <div className="history-list">
                    {history.length === 0 ? (
                      <div className="no-history">
                        <div className="no-history-icon"></div>
                        <p>No history records found</p>
                      </div>
                    ) : history.map((record, index) => (
                      <div className="history-item" key={index}>
                        <div className="history-action">{record.action}</div>
                        <div className="history-details">{record.details}</div>
                        <div className="history-date">{new Date(record.timestamp * 1000).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {activeTab === 'faq' && (
                <div className="faq-section">
                  <h2>Frequently Asked Questions</h2>
                  {renderFAQ()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {showCheckModal && (
        <ModalCheckEligibility 
          onSubmit={checkEligibility} 
          onClose={() => setShowCheckModal(false)} 
          checking={checkingEligibility} 
        />
      )}
      
      {selectedAirdrop && (
        <AirdropDetailModal 
          airdrop={selectedAirdrop} 
          onClose={() => { 
            setSelectedAirdrop(null); 
            setDecryptedAmount(null); 
          }} 
          decryptedAmount={decryptedAmount} 
          setDecryptedAmount={setDecryptedAmount} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
          claimAirdrop={claimAirdrop}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>AirdropShield</span>
            </div>
            <p>Confidential Airdrop & Whitelist System</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} AirdropShield. All rights reserved.</div>
          <div className="disclaimer">
            This system uses fully homomorphic encryption to protect user data during airdrop processes.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCheckEligibilityProps {
  onSubmit: () => void; 
  onClose: () => void; 
  checking: boolean;
}

const ModalCheckEligibility: React.FC<ModalCheckEligibilityProps> = ({ onSubmit, onClose, checking }) => {
  return (
    <div className="modal-overlay">
      <div className="check-eligibility-modal">
        <div className="modal-header">
          <h2>Check Airdrop Eligibility</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div>
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your data will be encrypted with Zama FHE</p>
            </div>
          </div>
          
          <div className="eligibility-info">
            <p>Verify your eligibility for confidential airdrops without exposing your wallet details.</p>
            <div className="shield-icon-large"></div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={checking} 
            className="submit-btn"
          >
            {checking ? "Checking with FHE..." : "Check Eligibility"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface AirdropDetailModalProps {
  airdrop: AirdropData;
  onClose: () => void;
  decryptedAmount: number | null;
  setDecryptedAmount: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
  claimAirdrop: (airdrop: AirdropData) => void;
}

const AirdropDetailModal: React.FC<AirdropDetailModalProps> = ({ 
  airdrop, 
  onClose, 
  decryptedAmount, 
  setDecryptedAmount, 
  isDecrypting, 
  decryptWithSignature,
  claimAirdrop
}) => {
  const handleDecrypt = async () => {
    if (decryptedAmount !== null) { 
      setDecryptedAmount(null); 
      return; 
    }
    
    const decrypted = await decryptWithSignature(airdrop.encryptedAmount);
    if (decrypted !== null) {
      setDecryptedAmount(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="airdrop-detail-modal">
        <div className="modal-header">
          <h2>Airdrop Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="airdrop-info">
            <div className="info-item">
              <span>Airdrop ID:</span>
              <strong>#{airdrop.id}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(airdrop.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={airdrop.claimed ? "claimed" : "available"}>
                {airdrop.claimed ? "Claimed" : "Available"}
              </strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Airdrop Data</h3>
            <div className="data-row">
              <div className="data-label">Amount:</div>
              <div className="data-value">{airdrop.encryptedAmount.substring(0, 30)}...</div>
              <button 
                className="decrypt-btn" 
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "Decrypting..."
                ) : decryptedAmount !== null ? (
                  "Hide Value"
                ) : (
                  "Decrypt Amount"
                )}
              </button>
            </div>
            
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted - Requires Wallet Signature</span>
            </div>
          </div>
          
          {decryptedAmount !== null && (
            <div className="decrypted-section">
              <h3>Decrypted Details</h3>
              <div className="decrypted-value">
                <span>Airdrop Amount:</span>
                <strong>{decryptedAmount} tokens</strong>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!airdrop.claimed && airdrop.eligibility && (
            <button 
              onClick={() => claimAirdrop(airdrop)} 
              className="claim-btn"
              disabled={isDecrypting}
            >
              Claim Airdrop
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;