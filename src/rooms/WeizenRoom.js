import { Room } from 'colyseus';
import { ArraySchema } from '@colyseus/schema';
import { WeizenState } from '../schema/WeizenState.js';
import { Player } from '../schema/Player.js';
import { Card } from '../schema/Card.js';
import { BidEntry } from '../schema/BidEntry.js';
import { verifyJWT } from "../util/jwt.util.js";
import { User } from "../models/User.js"; // (make sure you imported this)
import { resolveBalance, getPlayBalance } from '../solana/anchorClient.js';


const PHASES = {
  WAITING: "waiting",
  DEALING: "dealing",
  BIDDING: "bidding",
  PLAYING: "playing",
  SCORING: "scoring",
  FINISHED: "finished"
};

const BID = {
  Pass: 0,
  Vraag: 1,
  Meegaan: 2,
  AlleenGaan: 3,
  GeenDames: 4,
  Pico: 5,
  Misere: 6,
  OpenMisere: 7,
  Troel: 8,
  Abondance: 9,
  AbondanceInTroef: 10,
  SoloSlim: 11
};

const BID_PRIORITY = [
  BID.Troel,
  BID.SoloSlim,
  BID.OpenMisere,
  BID.AbondanceInTroef,
  BID.Abondance,
  BID.Pico,
  BID.Misere,
  BID.Vraag,
  BID.Meegaan,
  BID.AlleenGaan,
  BID.GeenDames,
  BID.Pass
];

export class WeizenRoom extends Room {
  onCreate(options) {
    if (this.debug) console.log('✅ WeizenRoom created');

    // ✅ Game state
    this.state = new WeizenState();

    // ✅ Config
    this.maxClients = 4;

    // ✅ User/session mapping
    this.userPlayers = new Map();
    this.sessionToUserId = new Map();

    // ✅ Voting / anti-cheating
    this.voteCheatMap = new Map();

    // ✅ Round and contract
    this.trumpCard = null;
    this.contract = null;

    // ✅ Ready state tracking
    this.readyUser = new Set();         // lobby -> startGame
    this.dealReadyUser = new Set();     // DEALING -> BIDDING
    this.roundReadyUser = new Set();    // SCORING -> next round

    // ✅ Bidding phase control
    this.activeBidders = new Set();
    this.passesInARow = 0;

    this.buyin = 100;

    this.debug = options?.debug || true;

    // ✅ Messages
    this.onMessage("ready", (client, ready) => this.handleReady(client, ready));
    this.onMessage("deal", (client, ready) => this.handleDealReady(client, ready));
    this.onMessage("bid", (client, bid) => this.handleBid(client, bid));
    this.onMessage("playCard", (client, card) => this.handlePlayCard(client, card));
    this.onMessage("playCardReady", (client) => {});
    this.onMessage("voteCheat", (client, vote) => this.handleVoteCheat(client, vote));
    this.onMessage("roundReady", (client) => this.handleNextRoundReady(client));

    if (this.debug) console.log('✅ Room initialized and ready for players!');
  }


  async onAuth(client, options) {
    if (this.debug) console.log(`🔐 Authenticating ${client.sessionId}`);
    const token = options.token;
    const user = verifyJWT(token);
    if (!user) throw new Error("Unauthorized");
    let pubkey = await User.getPubKeyById(user.id);
    // let entryFee = await User.getEntryFeeById(user.id);
    // if (!entryFee || entryFee < 0.0001) throw new Error("Insufficient Entry");
    console.log("User pubKey is "+pubkey);
    if (!pubkey) throw new Error("User PubKey Required");
    let balance = await getPlayBalance(pubkey);
    if (balance < this.buyin) throw new Error("Insufficient balance");
    await resolveBalance(pubkey, this.buyin * -1);
    client.userData = user;
    return true;
  }

  onJoin(client, options) {
    const userId = client.userData.id;
    const username = client.userData.username || "Guest";
    const avatar = client.userData.avatar || "/uploads/images/avatar/photo1.jpg";

    if (this.debug) console.log(`✅ Player joined: ${client.sessionId} (userId=${userId})`);
    this.sessionToUserId.set(client.sessionId, userId);

    let player;
    if (this.userPlayers.has(userId)) {
      if (this.debug) console.log(`🔄 Reconnecting user ${userId}`);

      // ✅ Find and remove old client
      const oldSessionId = this.userPlayers.get(userId).id;
      if (oldSessionId && oldSessionId !== client.sessionId) {
        const oldClient = this.clients.find(c => c.sessionId === oldSessionId);
        if (oldClient) {
          if (this.debug) console.log(`⚠️ Forcing old session to leave: ${oldSessionId}`);
          oldClient.leave();
        }
      }

      player = this.userPlayers.get(userId);
      player.id = client.sessionId;
    } 
    else {
      if (this.debug) console.log(`🆕 New user ${userId}`);
      player = new Player();
      player.id = client.sessionId;
      player.name = username;
      player.avatar = avatar;
      player.seat = `${this.userPlayers.size}`;
      player.hand = new ArraySchema();
      player.bid = 0;
      player.tricksWon = 0;
      player.score = 0;
      player.roundscore = 0;
      player.wznBalance = 100;
      player.cheatFlags = 0;
      player.capturedCards = new ArraySchema();

      this.userPlayers.set(userId, player);
    }

    this.state.players.set(player.id, player);
  }

  async onLeave(client, consented) {
    const userId = this.sessionToUserId.get(client.sessionId);
    if (!userId) return;

    if (consented) {
      if (this.debug) console.log(`❎ Player left voluntarily: ${client.sessionId}`);
      this.state.players.delete(client.sessionId);
      this.userPlayers.delete(userId);
      this.sessionToUserId.delete(client.sessionId);
    } else {
      if (this.debug) console.log(`⚠️ Player disconnected unexpectedly: ${client.sessionId}`);
      try {
        await this.allowReconnection(client, 60);
        if (this.debug) console.log(`✅ Player ${client.sessionId} reconnected`);
      } catch {
        if (this.debug) console.log(`❌ Player failed to reconnect`);
        this.state.players.delete(client.sessionId);
        this.userPlayers.delete(userId);
        this.sessionToUserId.delete(client.sessionId);
      }
    }

    if (this.state.players.size < this.maxClients) {
      this.state.phase = PHASES.WAITING;
    }
  }
  handleReady(client, ready) {
    if (!this.readyUser) this.readyUser = new Set();
    this.readyUser.add(client.sessionId);

    if (this.debug) console.log(`✅ Player ready to start: ${client.sessionId} (${this.readyUser.size}/${this.maxClients})`);

    if (this.readyUser.size >= this.maxClients) {
      this.readyUser.clear();  // Reset for next time
      this.startGame();
    }
  }

  // ✅ Game Start
  startGame() {
    if (this.debug) console.log('✅ Starting game...');
    this.readyUser = new Set();   // Ensure fresh
    this.state.roundNumber = 1;
    this.state.currentDealerIndex = 0;
    this.prepareRound();
  }

  handleDealReady(client, ready) {
    if (!this.dealReadyUser) this.dealReadyUser = new Set();
    this.dealReadyUser.add(client.sessionId);

    if (this.debug) console.log(`✅ Player ready for bidding: ${client.sessionId} (${this.dealReadyUser.size}/${this.maxClients})`);

    if (this.dealReadyUser.size >= this.maxClients) {
      this.dealReadyUser.clear();
      this.startBidding();
    }
  }

  prepareRound() {
    if (this.debug) console.log(`🟢 Preparing round ${this.state.roundNumber}`);
    this.voteCheatMap.clear();
    this.dealCards();
    this.state.phase = PHASES.DEALING;
    if (this.debug) console.log(`✅ Phase set to DEALING. Dealer: ${this.state.dealerId}, Trump: ${this.state.trumpSuit}`);
  }

  dealCards() {
    if (this.debug) console.log('🃏 Dealing cards...');
    const playerIds = Array.from(this.state.players.keys());
    const dealerIndex = this.state.currentDealerIndex % playerIds.length;
    const orderedPlayerIds = this.rotateLeft(playerIds, dealerIndex + 1);

    this.state.dealerId = playerIds[dealerIndex];

    const deck = this.generateDeck();
    this.shuffle(deck);

    this.trumpCard = deck[deck.length - 1];
    this.state.trumpSuit = this.trumpCard.suit;

    const hands = {};
    orderedPlayerIds.forEach(id => hands[id] = []);

    let current = 0;
    while (deck.length > 0) {
      hands[orderedPlayerIds[current % orderedPlayerIds.length]].push(deck.pop());
      current++;
    }

    for (const [id, player] of this.state.players.entries()) {
      player.hand.clear();
      player.hand.push(...hands[id]);
      player.bid = 0;
      player.tricksWon = 0;
      player.roundscore = 0;
      player.capturedCards.clear();
    }

    if (this.debug) console.log(`✅ Cards dealt. Trump is ${this.trumpCard.rank} of ${this.trumpCard.suit}`);
  }

  startBidding() {
    if (this.debug) console.log('🎯 Starting bidding phase');
    this.state.phase = PHASES.BIDDING;
    this.state.bids.clear();

    const playerIds = Array.from(this.state.players.keys());
    const dealerIndex = this.state.currentDealerIndex % playerIds.length;
    this.state.turnOrder = new ArraySchema(...this.rotateLeft(playerIds, dealerIndex + 1));
    this.state.currentTurnIndex = 0;
    this.passesInARow = 0;
    this.activeBidders = new Set(this.state.turnOrder);

    if (this.debug) console.log(`🟢 Turn order for bidding: ${this.state.turnOrder.join(', ')}`);
    this.promptNextBidder();
  }

  promptNextBidder() {
    if (this.activeBidders.size <= 1 || this.passesInARow >= 3) {
      if (this.debug) console.log('✅ Ending bidding phase');
      this.finishBidding();
      return;
    }

    this.state.currentBidderId = this.state.turnOrder[this.state.currentTurnIndex % this.state.turnOrder.length];
    if (this.debug) console.log(`🔔 Prompting bid from: ${this.state.currentBidderId}`);
    this.broadcast("promptBid", { playerId: this.state.currentBidderId });
  }

  handleBid(client, bidType) {
    const playerId = client.sessionId;
    const player = this.state.players.get(playerId);
    if (!player || this.state.phase !== PHASES.BIDDING) return;

    if (this.debug) console.log(`✅ Bid received from ${player.name}: ${bidType}`);

    if (bidType === BID.Pass) {
      this.passesInARow++;
      this.activeBidders.delete(playerId);
    } else {
      try {
        this.validateBid(player, bidType);
      } catch (err) {
        client.send("error", { message: err.message });
        console.warn(`⚠️ Invalid bid by ${player.name}: ${err.message}`);
        return;
      }
      this.passesInARow = 0;
      this.activeBidders.add(playerId);
    }

    this.state.bids.push(new BidEntry().assign({ playerId: playerId, bidType }));
    this.broadcast("promptBidRes", { playerId, bid: bidType });

    if (this.activeBidders.size <= 1 || this.passesInARow >= 3) {
      this.finishBidding();
      return;
    }

    this.state.currentTurnIndex = (this.state.currentTurnIndex + 1) % this.state.turnOrder.length;
    this.promptNextBidder();
  }

  finishBidding() {
    if (this.debug) console.log('✅ Finishing bidding phase');
    const validBids = this.state.bids
      .filter(b => b.bidType !== BID.Pass)
      .sort((a, b) => BID_PRIORITY.indexOf(a.bidType) - BID_PRIORITY.indexOf(b.bidType));

    if (validBids.length === 0) {
      if (this.debug) console.log('⚠️ All players passed.');
      this.broadcast("allPlayersPassed");
      this.prepareNextRound();
      return;
    }

    const winningBid = validBids[0];
    this.state.winningBid = winningBid;

    if (this.debug) console.log(`🏆 Winning bid: Player ${winningBid.playerId} with type ${winningBid.bidType}`);
    this.broadcast("winningBid", { playerId: winningBid.playerId, bidType: winningBid.bidType });

    this.configureContract();
    this.startPlayPhase();
  }
  
  configureContract() {
    console.log('🛠️ Configuring contract...');

    if (!this.state.winningBid) {
      console.warn('⚠️ No winning bid to configure.');
      return;
    }

    const winningBid = this.state.winningBid;
    const bidType = winningBid.bidType;
    const bidderId = winningBid.playerId;

    this.contract = {
      type: bidType,
      bidderId: bidderId,
      partners: []
    };

    // ✅ Handle Vraag/Meegaan
    if (bidType === BID.Vraag || bidType === BID.Meegaan) {
      // Find Meegaan partner
      const meegaanBid = this.state.bids.find(b => b.bidType === BID.Meegaan);
      if (meegaanBid) {
        this.contract.partners = [bidderId, meegaanBid.playerId];
      } else {
        console.warn('⚠️ Vraag declared but no Meegaan found.');
        this.contract.partners = [bidderId];  // Solo fallback
      }
    }

    // ✅ Handle Troel
    else if (bidType === BID.Troel) {
      const bidder = this.state.players.get(bidderId);
      const aceSuitCounts = {};

      for (const c of bidder.hand) {
        if (c.rank.toLowerCase() === 'ace') {
          aceSuitCounts[c.suit] = true;
        }
      }

      // Partner = player with 4th Ace
      for (const p of this.state.players.values()) {
        if (p.id === bidderId) continue;
        for (const c of p.hand) {
          if (c.rank.toLowerCase() === 'ace' && !aceSuitCounts[c.suit]) {
            this.contract.partners = [bidderId, p.id];
            break;
          }
        }
      }

      if (this.contract.partners.length < 2) {
        console.warn('⚠️ Troel partner not found, using solo.');
        this.contract.partners = [bidderId];
      }
    }

    // ✅ Else solo
    else {
      this.contract.partners = [bidderId];
    }

    // ✅ Trump Suit
    // By rules, certain bids choose their trump (you can customize this)
    // For now, we'll use the dealt trump
    this.contract.trumpSuit = this.state.trumpSuit;

    // Store in state for clients
    this.state.contractType = this.contract.type;
    this.state.contractBidderId = this.contract.bidderId;
    this.state.contractPartners = new ArraySchema(...this.contract.partners);
    this.state.trumpSuit = this.contract.trumpSuit;

    console.log(`✅ Contract configured: Type=${bidType}, Bidder=${bidderId}, Partners=${this.contract.partners.join(', ')}, Trump=${this.contract.trumpSuit}`);
  }

  validateBid(player, bidType) {
    if (!Object.values(BID).includes(bidType)) {
      throw new Error('Invalid bid type!');
    }

    if (bidType === BID.Troel) {
      const aceCount = player.hand.filter(card => card.rank.toLowerCase() === 'ace').length;
      if (aceCount < 3) {
        throw new Error('Troel requires 3 Aces in hand!');
      }
    }

    if (bidType === BID.Meegaan) {
      const vraagExists = this.state.bids.some(b => b.bidType === BID.Vraag);
      if (!vraagExists) {
        throw new Error('Meegaan requires Vraag to be declared first.');
      }
      const meegaanCount = this.state.bids.filter(b => b.bidType === BID.Meegaan).length;
      if (meegaanCount >= 1) {
        throw new Error('Only one Meegaan is allowed.');
      }
    }
  }
  startPlayPhase() {
    if (this.debug) console.log('🎮 Starting Play Phase');

    this.state.phase = PHASES.PLAYING;
    this.state.currentTurnIndex = 0;
    this.trickSuit = "";
    this.trickPlayerCards = {};
    this.cardPlayedUser = [];

    // Leader starts first trick = winning bidder
    this.state.turnOrder = new ArraySchema(
      ...this.rotateLeft(
        Array.from(this.state.players.keys()),
        this.state.turnOrder.indexOf(this.contract.bidderId)
      )
    );

    if (this.debug) console.log(`🟢 Play phase turnOrder: ${this.state.turnOrder.join(', ')}`);

    this.broadcast("playPhaseStarted", {
      turnOrder: this.state.turnOrder,
      trumpSuit: this.contract?.trumpSuit
    });

    this.promptNextPlayer();
  }

  promptNextPlayer() {
    if (this.cardPlayedUser.length >= this.maxClients) {
      if (this.debug) console.log('✅ All players have played this trick.');
      this.resolveTrick();
      return;
    }

    const currentPlayerId = this.state.turnOrder[this.state.currentTurnIndex % this.state.turnOrder.length];
    this.state.currentBidderId = currentPlayerId;

    if (this.debug) console.log(`🔔 Prompting next player to play: ${currentPlayerId}`);
    this.broadcast("promptPlay", {
      playerId: currentPlayerId,
      trickSuit: this.trickSuit
    });
  }

  handlePlayCard(client, playedCard) {
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.phase !== PHASES.PLAYING) return;

    // Must-follow suit validation
    if (this.trickSuit) {
      const hasLedSuit = player.hand.some(c => c.suit === this.trickSuit);
      if (hasLedSuit && playedCard.suit !== this.trickSuit) {
        console.warn(`⚠️ ${player.name} attempted to break suit.`);
        client.send("error", { message: `You must follow suit: ${this.trickSuit}` });
        this.promptNextPlayer();
        return;
      }
    } else {
      this.trickSuit = playedCard.suit;
    }

    if (this.debug) console.log(`✅ ${player.name} played ${playedCard.rank} of ${playedCard.suit}`);

    this.trickPlayerCards[client.sessionId] = playedCard;

    this.broadcast("promptPlayCard", {
      playerId: client.sessionId,
      card: playedCard
    });

    player.hand = new ArraySchema(
      ...player.hand.filter(c => !(c.rank === playedCard.rank && c.suit === playedCard.suit))
    );

    this.cardPlayedUser.push(client.sessionId);

    if (this.cardPlayedUser.length < this.maxClients) {
      this.state.currentTurnIndex++;
      this.promptNextPlayer();
    } else {
      this.resolveTrick();
    }
  }

  resolveTrick() {
    if (this.debug) console.log('🟠 Resolving trick');

    let winningPlayerId = null;
    let bestValue = -1;
    const trumpSuit = this.contract?.trumpSuit;
    const ledSuit = this.trickSuit;

    for (const [id, card] of Object.entries(this.trickPlayerCards)) {
      let value = this.rankValue(card.rank);
      if (trumpSuit && card.suit === trumpSuit) {
        value += 1000;
      } else if (card.suit === ledSuit) {
        value += 100;
      }

      if (value > bestValue) {
        bestValue = value;
        winningPlayerId = id;
      }
    }

    if (this.debug) console.log(`🏆 Trick winner: ${winningPlayerId}`);

    const winner = this.state.players.get(winningPlayerId);
    winner.tricksWon += 1;

    for (const card of Object.values(this.trickPlayerCards)) {
      winner.capturedCards.push(new Card(card.rank, card.suit));
    }

    this.broadcast("trickResult", {
      winnerId: winningPlayerId,
      cards: this.trickPlayerCards
    });

    this.state.turnOrder = new ArraySchema(
      ...this.rotateLeft(
        Array.from(this.state.turnOrder),
        this.state.turnOrder.indexOf(winningPlayerId)
      )
    );

    if (this.debug) console.log(`🔄 New turnOrder: ${this.state.turnOrder.join(', ')}`);

    this.trickSuit = "";
    this.trickPlayerCards = {};
    this.cardPlayedUser = [];

    if (this.isRoundOver()) {
      if (this.debug) console.log('✅ Round complete. Scoring next...');
      this.startScoring();
    } else {
      this.state.currentTurnIndex = 0;
      this.promptNextPlayer();
    }
  }

  isRoundOver() {
    for (const player of this.state.players.values()) {
      if (player.hand.length > 0) return false;
    }
    return true;
  }

  rankValue(rank) {
    const order = ['2','3','4','5','6','7','8','9','10','jack','queen','king','ace'];
    return order.indexOf(rank);
  }
  startScoring() {
    if (this.debug) console.log('📜 Starting scoring phase');

    this.state.phase = PHASES.SCORING;

    this.scoreContract();
    this.updateScoreHistory();
    // this.settleWZN();

    this.roundReadyUser = new Set();

    this.broadcast("roundScored", {
      roundNumber: this.state.roundNumber,
      contractType: this.contract?.type,
      contractBidderId: this.contract?.bidderId,
      trumpSuit: this.contract?.trumpSuit
    });

    if (this.debug) console.log('✅ Scoring complete. Waiting for players to ready.');
  }

  async updateScoreHistory() {
    const contractType = this.state.contractType;
    const contractBidderId = this.state.contractBidderId;
    const partners = this.state.contractPartners;

    for (const [sessionId, player] of this.state.players.entries()) {
      const userId = this.sessionToUserId.get(sessionId);
      if (!userId) continue;

      const scoreDelta = player.roundscore || 0;
      const isPartner = partners.includes(player.id);
      const success = isPartner ? scoreDelta > 0 : scoreDelta >= 0;

      // Build history record
      const roundEntry = {
        date: new Date(),
        contractType,
        success,
        scoreDelta
      };

      // Save to DB
      try {
        await User.findByIdAndUpdate(userId, {
          $push: { roundHistory: roundEntry },
          // $inc: { wznBalance: player.wznBalance } // optional flag reset
        });
        // const pubkeyStr = await User.findById(userId).then(u => u?.PubkeyStr);
        // resolveBalance(pubkeyStr, scoreDelta);
        if (this.debug) console.log(`📝 Round history saved for ${player.name}`);
      } catch (err) {
        console.warn(`❌ Failed to update roundHistory for ${player.name}`, err);
      }
    }
  }

  settleWZN() {
    if (this.debug) console.log('💰 Settling WZN balances for round');

    for (const player of this.state.players.values()) {
      player.wznBalance = 0;
    }

    let maxScore = -Infinity;
    const topPlayers = [];

    for (const player of this.state.players.values()) {
      player.wznBalance += player.score;

      if (this.debug) {
        console.log(`🪙 ${player.name} WZN=${player.wznBalance} (change=${player.roundscore})`);
      }

      if (player.score > maxScore) {
        maxScore = player.score;
      }
    }

    // Find all players with top score
    for (const player of this.state.players.values()) {
      if (player.score === maxScore) {
        topPlayers.push(player);
      }
    }

    const winamount = (this.buyin * 4) / topPlayers.length;
    // distribute
    for (const player of topPlayers) {
      player.wznBalance = winamount;
      const client = this.clients.find(c => c.sessionId === player.id);
      resolveBalance(client.userData.id, winamount);
      changeEntryFee(client.userData.id, -0.00001);
    }
  }
  async changeEntryFee(userId, delta) {
    try {
      const result = await User.findByIdAndUpdate(
        userId,
        { $inc: { entryFee: delta } },
        { new: true }
      );
      console.log(`✅ Entry fee changed by ${delta}. New value: ${result.entryFee}`);
      return result.entryFee;
    } catch (err) {
      console.error('❌ Failed to change entry fee:', err);
      return null;
    }
  }
  handleNextRoundReady(client) {
    if (!this.roundReadyUser) this.roundReadyUser = new Set();
    this.roundReadyUser.add(client.sessionId);

    if (this.debug) console.log(`✅ Player ready for next round: ${client.sessionId} (${this.roundReadyUser.size}/${this.maxClients})`);

    if (this.roundReadyUser.size >= this.maxClients) {
      this.prepareNextRound();
    }
  }

  prepareNextRound() {
    if (this.debug) console.log(`🔄 Preparing next round`);

    this.state.roundNumber += 1;
    this.state.currentDealerIndex = (this.state.currentDealerIndex + 1) % this.maxClients;

    for (const player of this.state.players.values()) {
      player.bid = 0;
      player.tricksWon = 0;
      player.roundscore = 0;
      player.hand.clear();
      player.capturedCards.clear();
    }

    this.contract = null;
    this.voteCheatMap.clear();

    if (this.state.roundNumber > 10) {
      this.state.phase = PHASES.FINISHED;
      this.broadcast("gameFinished", { message: "Game over. Thanks for playing!" });

      this.settleWZN();

    } else {
      this.prepareRound();
    }
  }

  // ✅ Contract Scoring Dispatcher
  scoreContract() {
    if (!this.contract) return;
    const bidType = this.contract.type;

    switch (bidType) {
      case BID.Vraag:
      case BID.Meegaan:
        this.scoreVraagMeegaan();
        break;
      case BID.AlleenGaan:
        this.scoreAlleenGaan();
        break;
      case BID.GeenDames:
        this.scoreGeenDames();
        break;
      case BID.Pico:
        this.scorePico();
        break;
      case BID.Misere:
      case BID.OpenMisere:
        this.scoreMisere();
        break;
      case BID.Troel:
        this.scoreTroel();
        break;
      case BID.Abondance:
      case BID.AbondanceInTroef:
        this.scoreAbondance();
        break;
      case BID.SoloSlim:
        this.scoreSoloSlim();
        break;
      default:
        break;
    }
  }

  // ✅ Individual scoring functions go here
    scoreVraagMeegaan() {
    const partners = this.contract.partners;
    let teamTricks = 0;

    partners.forEach(pid => {
      teamTricks += this.state.players.get(pid).tricksWon;
    });

    // Point per partner based on tricks
    let pointsPerPartner;
    if (teamTricks >= 8 && teamTricks <= 12) {
      pointsPerPartner = teamTricks - 6;
    } else if (teamTricks === 13) {
      pointsPerPartner = 14;
    } else {
      // Failed: same in reverse
      pointsPerPartner = (teamTricks - 7);
    }

    // Update partner scores
    for (const pid of partners) {
      const p = this.state.players.get(pid);
      p.score += pointsPerPartner;
      p.roundscore = pointsPerPartner;
    }

    // Update opponents
    for (const p of this.state.players.values()) {
      if (!partners.includes(p.id)) {
        p.score -= pointsPerPartner;
        p.roundscore = -pointsPerPartner;
      }
    }

    if (this.debug) console.log(`✅ Vraag/Meegaan tricks=${teamTricks}, ±${pointsPerPartner} per player`);
  }

  scoreAlleenGaan() {
    const player = this.state.players.get(this.contract.bidderId);
    const tricks = player.tricksWon;

    if (tricks >= 5) {
      const totalGain = Math.min(6 + (tricks - 5) * 3, 30);
      const lossPerOpponent = Math.floor(totalGain / 3);

      player.score += totalGain;
      player.roundscore = totalGain;

      for (const p of this.state.players.values()) {
        if (p.id !== player.id) {
          p.score -= lossPerOpponent;
          p.roundscore = -lossPerOpponent;
        }
      }

      if (this.debug) console.log(`✅ Alleen Gaan success! Tricks=${tricks}, +${totalGain} to bidder, –${lossPerOpponent} each opponent`);
    } else {
      // Failure penalty
      player.score -= 6;
      player.roundscore = -6;

      for (const p of this.state.players.values()) {
        if (p.id !== player.id) {
          p.score += 2;
          p.roundscore = 2;
        }
      }

      if (this.debug) console.log(`❌ Alleen Gaan failed. Tricks=${tricks}, –6 bidder, +2 each opponent`);
    }
  }

  scoreGeenDames() {
    let totalPenalty = 0;
    const queens = {};

    for (const p of this.state.players.values()) {
      const qCount = p.capturedCards.filter(c => c.rank.toLowerCase() === 'queen').length;
      const penalty = qCount * 4;
      queens[p.id] = penalty;
      totalPenalty += penalty;
      p.score -= penalty;
      p.roundscore = -penalty;
    }

    // Distribute lost points to players with zero queens
    const winners = Array.from(this.state.players.values()).filter(p => queens[p.id] === 0);
    if (winners.length > 0) {
      const split = Math.floor(totalPenalty / winners.length);
      for (const p of winners) {
        p.score += split;
        p.roundscore = split;
      }
    }

    if (this.debug) console.log(`✅ Geen Dames resolved. Total penalty=${totalPenalty}`);
  }

  scorePico() {
    const results = [];
    for (const p of this.state.players.values()) {
      const win = p.tricksWon === 0;
      results.push({ p, win });
    }

    const winners = results.filter(r => r.win);
    const losers = results.filter(r => !r.win);

    if (winners.length === 1) {
      // Solo winner
      winners[0].p.score += 15;
      winners[0].p.roundscore = 15;
      losers.forEach(r => {
        r.p.score -= 5;
        r.p.roundscore = -5;
      });
    } else if (winners.length === 2) {
      // Split win
      winners.forEach(r => {
        r.p.score += 10;
        r.p.roundscore = 10;
      });
      losers.forEach(r => {
        r.p.score -= 5;
        r.p.roundscore = -5;
      });
    } else {
      // Mixed or 0/3/4 winners = zero-sum
      results.forEach(r => r.p.roundscore = 0);
    }

    if (this.debug) console.log(`✅ Pico scoring complete. Winners=${winners.length}`);
  }

  scoreMisere() {
    const player = this.state.players.get(this.contract.bidderId);
    const success = player.tricksWon === 0;

    for (const p of this.state.players.values()) {
      if (p.id === player.id) {
        if (success) {
          p.score += 15;
          p.roundscore = 15;
        } else {
          p.score -= 15;
          p.roundscore = -15;
        }
      } else {
        if (success) {
          p.score -= 5;
          p.roundscore = -5;
        } else {
          p.score += 5;
          p.roundscore = 5;
        }
      }
    }

    if (this.debug) console.log(`✅ Misere ${success ? 'success' : 'fail'} for bidder`);
  }

  scoreTroel() {
    const partners = this.contract.partners;
    let teamTricks = 0;
    partners.forEach(pid => {
      teamTricks += this.state.players.get(pid).tricksWon;
    });

    let perPartner;
    if (teamTricks === 13) {
      perPartner = 28;
    } else if (teamTricks >= 9) {
      perPartner = 6 + (teamTricks - 9) * 2;
    } else if (teamTricks >= 8) {
      perPartner = 4;
    } else {
      perPartner = -4;
    }

    partners.forEach(pid => {
      const p = this.state.players.get(pid);
      p.score += perPartner;
      p.roundscore = perPartner;
    });

    for (const p of this.state.players.values()) {
      if (!partners.includes(p.id)) {
        p.score -= perPartner;
        p.roundscore = -perPartner;
      }
    }

    if (this.debug) console.log(`✅ Troel scoring. Tricks=${teamTricks}, ±${perPartner} per partner`);
  }

  scoreAbondance() {
    const p = this.state.players.get(this.contract.bidderId);
    const tricks = p.tricksWon;
    let reward;

    if (tricks < 9) {
      // Fail
      reward = -12;
    } else if (tricks === 9) reward = 12;
    else if (tricks === 10) reward = 15;
    else if (tricks === 11) reward = 18;
    else if (tricks === 12) reward = 24;
    else reward = 30;

    p.score += reward;
    p.roundscore = reward;

    const opponentPenalty = Math.floor(Math.abs(reward) / 3);
    for (const other of this.state.players.values()) {
      if (other.id !== p.id) {
        other.score -= Math.sign(reward) * opponentPenalty;
        other.roundscore = -Math.sign(reward) * opponentPenalty;
      }
    }

    if (this.debug) console.log(`✅ Abondance tricks=${tricks}, bidder ±${reward}`);
  }

  scoreSoloSlim() {
    const p = this.state.players.get(this.contract.bidderId);
    const success = p.tricksWon === 13;

    if (success) {
      p.score += 39;
      p.roundscore = 39;
    } else {
      p.score -= 39;
      p.roundscore = -39;
    }

    for (const other of this.state.players.values()) {
      if (other.id !== p.id) {
        if (success) {
          other.score -= 13;
          other.roundscore = -13;
        } else {
          other.score += 13;
          other.roundscore = 13;
        }
      }
    }

    if (this.debug) console.log(`✅ SoloSlim ${success ? 'success' : 'fail'}`);
  }


  // ✅ Voting System
  handleVoteCheat(client, vote) {
    if (!this.voteCheatMap) this.voteCheatMap = new Map();
    this.voteCheatMap.set(client.sessionId, vote);

    if (this.voteCheatMap.size >= this.maxClients) {
      const votes = Array.from(this.voteCheatMap.values());
      const yesVotes = votes.filter(v => v === true).length;
      if (yesVotes > this.maxClients / 2) {
        this.broadcast("roundVoided", { reason: "Cheating suspected" });
        for (const p of this.state.players.values()) {
          if (vote) p.cheatFlags += 1;
        }
        this.prepareNextRound();
      } else {
        this.broadcast("voteFailed", { message: "Not enough votes to void round" });
      }
    }
  }

  // ✅ Utilities
  generateDeck() {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const ranks = ['2','3','4','5','6','7','8','9','10','jack','queen','king','ace'];
    const deck = [];
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push(new Card({ rank, suit }));
      }
    }
    return deck;
  }

  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  rotateLeft(arr, n) {
    n = n % arr.length;
    return arr.slice(n).concat(arr.slice(0, n));
  }
}
