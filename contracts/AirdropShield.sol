pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AirdropShieldFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    mapping(uint256 => bool) public batchClosed;
    mapping(uint256 => mapping(address => euint32)) public encryptedUserScores;
    mapping(uint256 => mapping(address => ebool)) public encryptedUserEligibility;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event UserSubmission(address indexed user, uint256 indexed batchId, euint32 encryptedScore, ebool encryptedEligibility);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint32 totalEligibleUsers);

    error NotOwner();
    error NotProvider();
    error PausedError();
    error CooldownActive();
    error BatchClosedError();
    error ReplayError();
    error StateMismatchError();
    error InvalidBatchId();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    modifier checkCooldown(address _user) {
        if (block.timestamp < lastSubmissionTime[_user] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        emit ProviderAdded(owner);
        currentBatchId = 1;
        emit BatchOpened(currentBatchId);
        cooldownSeconds = 60; // Default cooldown: 1 minute
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        emit CooldownSecondsSet(cooldownSeconds, newCooldownSeconds);
        cooldownSeconds = newCooldownSeconds;
    }

    function openNewBatch() external onlyOwner {
        currentBatchId++;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch(uint256 batchId) external onlyOwner {
        if (batchId == 0 || batchId > currentBatchId) revert InvalidBatchId();
        if (!batchClosed[batchId]) {
            batchClosed[batchId] = true;
            emit BatchClosed(batchId);
        }
    }

    function submitUserData(
        address user,
        euint32 encryptedScore,
        ebool encryptedEligibility,
        uint256 batchId
    ) external onlyProvider whenNotPaused checkCooldown(user) {
        if (batchId == 0 || batchId > currentBatchId) revert InvalidBatchId();
        if (batchClosed[batchId]) revert BatchClosedError();

        _initIfNeeded(encryptedScore);
        _initIfNeeded(encryptedEligibility);

        encryptedUserScores[batchId][user] = encryptedScore;
        encryptedUserEligibility[batchId][user] = encryptedEligibility;

        lastSubmissionTime[user] = block.timestamp;
        emit UserSubmission(user, batchId, encryptedScore, encryptedEligibility);
    }

    function requestEligibilityCount(uint256 batchId) external whenNotPaused checkCooldown(msg.sender) {
        if (batchId == 0 || batchId > currentBatchId) revert InvalidBatchId();
        if (!batchClosed[batchId]) revert BatchClosedError(); // Only allow for closed batches

        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        euint32 encryptedCount = FHE.asEuint32(0);
        address[] memory users = new address[](0); // Placeholder for actual user list iteration

        // For this example, we'll assume a simplified iteration or a pre-defined list of users.
        // In a real scenario, you'd iterate through all users who submitted data for this batch.
        // For now, we'll just use a dummy user to demonstrate the FHE logic.
        // The actual sum would be: encryptedCount = encryptedCount.add(encryptedUserEligibility[batchId][user].toEuint32());

        // Example with a single dummy user (replace with actual iteration logic)
        // address dummyUser = address(0x1);
        // if (FHE.isInitialized(encryptedUserEligibility[batchId][dummyUser])) {
        //     encryptedCount = encryptedCount.add(encryptedUserEligibility[batchId][dummyUser].toEuint32());
        // }


        // For this simplified example, let's assume we are summing one specific user's eligibility
        // This is a placeholder for the actual aggregation logic over all users in the batch
        // In a real system, you would iterate through all users in the batch.
        // For demonstration, we'll use a single user. Replace this with your actual aggregation.
        address exampleUser = address(0x10000); // Example user address
        if (FHE.isInitialized(encryptedUserEligibility[batchId][exampleUser])) {
             encryptedCount = encryptedCount.add(encryptedUserEligibility[batchId][exampleUser].toEuint32());
        }


        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedCount);

        bytes32 stateHash = _hashCiphertexts(cts);

        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayError();
        // Security: Replay protection ensures a callback for a given requestId is processed only once.

        DecryptionContext memory ctx = decryptionContexts[requestId];
        bytes32 currentHash = _hashCiphertextsForCallback(ctx.batchId);
        // Security: State hash verification ensures that the contract state relevant to the decryption
        // (specifically, the ciphertexts that were supposed to be decrypted) has not changed
        // since the decryption was requested. This prevents attacks where an adversary might
        // alter the state after a decryption request but before the callback is processed,
        // potentially leading to inconsistent or malicious outcomes.
        if (currentHash != ctx.stateHash) revert StateMismatchError();

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 totalEligibleUsers = abi.decode(cleartexts, (uint32));

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, ctx.batchId, totalEligibleUsers);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal view returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _hashCiphertextsForCallback(uint256 batchId) internal view returns (bytes32) {
        // Reconstruct the ciphertexts array in the exact same order as in requestEligibilityCount
        // For this simplified example, we only had one ciphertext: the encryptedCount.
        // We need to reconstruct what that `cts` array would look like based on current storage.
        // This is crucial for state verification.

        euint32 reconstructedEncryptedCount = FHE.asEuint32(0);
        address exampleUser = address(0x10000); // Must be the same user as in requestEligibilityCount

        if (FHE.isInitialized(encryptedUserEligibility[batchId][exampleUser])) {
            reconstructedEncryptedCount = reconstructedEncryptedCount.add(encryptedUserEligibility[batchId][exampleUser].toEuint32());
        }
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(reconstructedEncryptedCount);
        
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 v) internal {
        if (!FHE.isInitialized(v)) {
            v = FHE.asEuint32(0);
        }
    }

    function _initIfNeeded(ebool b) internal {
        if (!FHE.isInitialized(b)) {
            b = FHE.asEbool(false);
        }
    }
}