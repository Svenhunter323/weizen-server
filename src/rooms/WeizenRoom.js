import { Room } from 'colyseus';
import {ArraySchema } from '@colyseus/schema';
import { WeizenState } from '../schema/WeizenState.js';
import { Player } from '../schema/Player.js';
import { Card } from '../schema/Card.js';
import { BidEntry } from '../schema/BidEntry.js';
import { verifyJWT } from "../util/jwt.util.js";

const suit_icon = "♥️♦️♣️♠️";

const PHASES = {
  WAITING: "waiting",
  DEALING: "dealing",
  BIDDING: "bidding",
  PLAYING: "playing",
  SCORING: "scoring"
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

const CONTRACT_SCORES = {
  [BID.Vraag]: 10,
  [BID.Meegaan]: 10,
  [BID.AlleenGaan]: 20,
  [BID.GeenDames]: -20, // penalty per Queen
  [BID.Pico]: 25,
  [BID.Misere]: 25,
  [BID.OpenMisere]: 30,
  [BID.Troel]: 30,
  [BID.Abondance]: 40,
  [BID.AbondanceInTroef]: 50,
  [BID.SoloSlim]: 50
};

const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
const ranks = ['2', '3', '4', '5', '6','7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];

export class WeizenRoom extends Room {
  onCreate(options) {
    console.log('✅ WeizenRoom created');
    this.state = new WeizenState();

    this.maxClients = 4;
    this.readyUser = {};
    this.dealReadyUser = {};
    this.cardPlayedUser = [];
    this.trickSuit = "";
    this.trickPlayerCards = {};
    this.roundReadyUser = [];
    this.trumpCard = new Card("ace", "spades");

    this.onMessage("ready", (client, ready) => this.handleReady(client, ready));
    this.onMessage("deal", (client, ready) => this.handleDealReady(client, ready));
    this.onMessage("bid", (client, bid) => this.handleBid(client, bid));
    this.onMessage("playCard", (client, card) => this.handlePlayCard(client, card));
    this.onMessage("playCardReady", (client) => this.handlePlayCardReady(client));
    this.onMessage("roundReady", (client) => this.handleNextRoundReady(client));
  }

  async onAuth(client, options) {
    console.log(`🔐 Authenticating ${client.sessionId}`);
    // You could check a JWT or session token here
    const token = options.token;
    const user = verifyJWT(token);
    if (!user) throw new Error("Unauthorized");
    client.userData = user;

    return true;
  }

  onJoin(client, options) {

    if (this.state.players.size >= this.maxClients) {
      console.warn('❌ Room full');
      client.leave();
      return;
    }
    const username = client.userData?.username || "Guest";
    // Check if the player has already joined
    if (this.clients.find(c => c.userData?.id === client.userData.id && c.sessionId !== client.sessionId)) {
      console.log(`❌ Player ${client.sessionId} is already in the room. Kicking them out.`);
      client.leave();  // Kick out the player if they are already in the room
      return;
    }
    console.log(`✅ Player joined: ${client.sessionId}`);

    const player = new Player();
    player.id = client.sessionId;
    // player.name = options.name || `Player-${this.state.players.size + 1}`;
    player.name = username || `Player-${this.state.players.size + 1}`;
    // player.seat = `Seat-${this.state.players.size + 1}`;
    player.seat = `${this.state.players.size}`;
    player.hand = new ArraySchema();
    player.bid = 0;
    player.tricksWon = 0;
    player.score = 0;
    player.roundscore = 0;

    this.state.players.set(client.sessionId, player);

    // if (this.state.players.size === this.maxClients) {
    //   this.startGame();
    // }
  }

  async onLeave(client, consented) {
    if (consented) {
      console.log(`❎ Player left voluntarily: ${client.sessionId}`);
      this.state.players.delete(client.sessionId);
    } else {
      console.log(`⚠️ Player disconnected unexpectedly: ${client.sessionId}`);

      try {
        await this.allowReconnection(client, 60);
        console.log(`✅ Player ${client.sessionId} reconnected`);
      } catch {
        console.log(`❌ Player ${client.sessionId} failed to reconnect in time`);
        this.state.players.delete(client.sessionId);
      }
    }

    if (this.state.players.size < this.maxClients) {
      this.state.phase = PHASES.WAITING;
    }
  }

  handleReady(client, ready) {
    this.readyUser[client.sessionId] = ready;

    var keys = Object.keys(this.readyUser);

    console.log(`✅ Player Ready: ${client.sessionId}\n current: ${keys.length}\n max: ${this.state.players.size}`);
    
    if (this.state.players.size === this.maxClients) {
      if (keys.length === this.maxClients) {
        this.startGame();
      }
    }
  }

  handleDealReady(client, ready) {
    this.dealReadyUser[client.sessionId] = ready;

    var keys = Object.keys(this.dealReadyUser);
    
    console.log(`✅ Player Deal Ready: ${client.sessionId}\n current: ${keys.length}\n max: ${this.state.players.size}`);
    
    if (this.state.players.size === this.maxClients) {
      if (keys.length === this.maxClients) {
        this.startBidding();
      }
    }
  }

  startGame() {
    console.log('✅ Starting game...');
    
    this.dealReadyUser = {};
    this.dealCards();
    this.state.phase = PHASES.DEALING;
  }

  dealCards() {
    console.log('🃏 Dealing cards...');
    const deck = this.generateDeck();
    this.shuffle(deck);
    this.trumpCard = deck[deck.length - 1];
    const hands = this.dealToPlayers(deck);

    for (const [id, player] of this.state.players.entries()) {
      player.hand.clear(); //= new ArraySchema(...hands[id]);
      player.hand.push(...hands[id]);
      player.bid = 0;
      player.tricksWon = 0;
      player.roundscore = 0;
      // console.log(player.hand.map(card => `${card.rank} of ${card.suit}`));
      // console.log(`✅ Hand for ${player.name}:`, player.hand.map(card => `${card.rank} of ${card.suit}`));
    }
  }

  generateDeck() {
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

  dealToPlayers(deck) {
    const hands = {};
    const playerIds = Array.from(this.state.players.keys());
    for (let i = 0; i < playerIds.length; i++) {
      hands[playerIds[i]] = [];
    }
    let current = 0;
    while (deck.length > 0) {
      hands[playerIds[current % playerIds.length]].push(deck.pop());
      current++;
    }
    return hands;
  }

  startBidding() {
    this.state.phase = PHASES.BIDDING;
    this.state.bids.clear();
    this.setupBiddingOrder();
    this.promptNextBidder();
  }

  setupBiddingOrder() {
    this.state.turnOrder = Array.from(this.state.players.keys());
    this.state.currentTurnIndex = 0;
  }

  promptNextBidder() {
    const currentId = this.state.turnOrder[this.state.currentTurnIndex];
    this.state.currentBidderId = currentId; // 👈 sync to client
    console.log(`🔔 Waiting for bid from: ${currentId}`);
    this.broadcast("promptBid", { playerId: currentId });
  }

  handleBid(client, bid) {
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.phase !== PHASES.BIDDING) return;

    try {
      this.validateBid(player, bid);
    } catch (err) {
      client.send("error", { message: err.message });
      return;
    }

    player.bid = bid;

    this.state.bids.push(new BidEntry().assign({
      playerId: player.id,
      bidType: bid
    }));

    this.broadcast("promptBidRes", { playerId: player.id, bid: bid });
    console.log(`✅ Received bid from ${player.name}: ${bid}`);

    this.state.currentTurnIndex++;
    if (this.state.currentTurnIndex >= this.state.turnOrder.length) {
      console.log('✅ Bidding complete');

      // ✅ New logic: resolve winner
      const winningBid = this.resolveWinningBid();

      if (!winningBid) {
        console.log('🟠 All players passed. Restarting round...');
        this.broadcast("allPlayersPassed");
        this.prepareNextRound();
        return;
      }

      // ✅ Store and broadcast winning contract
      this.state.winningBid = winningBid;
      this.broadcast("winningBid", {
        playerId: winningBid.playerId,
        bidType: winningBid.bidType
      });

      this.startPlayPhase();
    } else {
      this.promptNextBidder();
    }
  }

  startPlayPhase() {
    this.state.phase = PHASES.PLAYING;
    this.state.currentTurnIndex = 0;
    this.trickSuit = "";

    this.configureContract();

    console.log('🎮 Play phase started');
    this.promptNextPlayer();
  }

  promptNextPlayer() {
    const currentId = this.state.turnOrder[this.state.currentTurnIndex];
    console.log(`🔔 Waiting for move from: ${currentId}`);
    this.broadcast("promptPlay", { playerId: currentId, suit: this.trickSuit });
  }

  handlePlayCard(client, playedCard) {
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.phase !== PHASES.PLAYING) return;

    if (this.trickSuit == "") {
      this.trickSuit = playedCard.suit;
    }

    let suitcards = player.hand.filter(c => (c.suit === this.trickSuit));
    if (playedCard.suit != this.trickSuit && suitcards.length > 0) { // resend turn;
      this.promptNextPlayer();
      return;
    }

    console.log(`✅ ${player.name} played ${playedCard.rank} of ${playedCard.suit}`);

    this.trickPlayerCards[client.sessionId] = playedCard;

    this.broadcast("promptPlayCard", { playerId: client.sessionId, card: playedCard });

    // Remove the card by matching rank and suit
    const newHand = player.hand.filter(c => !(c.rank === playedCard.rank && c.suit === playedCard.suit));

    player.hand.clear();
    player.hand.push(...newHand)
    // player.hand = new ArraySchema(...newHand);

    // player.tricksWon += 1; // Simplified trick count
  }

  handlePlayCardReady(client) {
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.phase !== PHASES.PLAYING) return;

    if (this.cardPlayedUser.indexOf(player.id) >= 0) return;
    this.cardPlayedUser.push(player.id);

    if (this.cardPlayedUser.length < this.maxClients) return;

    this.cardPlayedUser = [];

    this.state.currentTurnIndex++;
    if (this.state.currentTurnIndex >= this.state.turnOrder.length) {
      console.log('✅ Trick complete');
      if (this.isRoundOver()) {
        this.startNextTrick(false);
        setTimeout(() => this.scoreRound(), 3000);
        // this.scoreRound();
      } else {
        this.startNextTrick();
      }
    } else {
      this.promptNextPlayer();
    }
  }

  isRoundOver() {
    for (const player of this.state.players.values()) {
      if (player.hand.length > 0) return false;
    }
    return true;
  }

  scoreRound() {
    console.log('✅ Scoring phase...');

    this.scoreContract();
    
    this.roundReadyUser = [];
    this.state.phase = PHASES.SCORING;
  }

  handleNextRoundReady(client) {
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.phase !== PHASES.SCORING) return;
    
    this.roundReadyUser.push(client.sessionId);
    
    if (this.roundReadyUser.length === this.maxClients) {
      setTimeout(() => this.prepareNextRound(), 3000);
    }
  }

  prepareNextRound() {
    console.log('🔄 Preparing next round');

    this.state.contractType = -1;
    this.state.contractBidderId = "";
    this.state.contractPartners.clear();
    this.state.trumpSuit = "";

    for (const player of this.state.players.values()) {
      player.bid = 0;
      player.tricksWon = 0;
      // player.hand = new ArraySchema();
      player.hand.clear();
      player.capturedCards.clear();
    }
    this.startGame();
  }

  startNextTrick(next = true) {

    // who is won & refresh players score
    var winner = null;
    for (const [id, player] of this.state.players.entries()) {
      if (winner === null) {
        winner = player;
        continue;
      }
      let playedCard = this.trickPlayerCards[id];
      let winnerCard = this.trickPlayerCards[winner.id];

      let winnerValue = ranks.indexOf(winnerCard.rank);
      let playerValue = ranks.indexOf(playedCard.rank);
      
      if (this.contract.trumpSuit != "" && winnerCard.suit == this.contract.trumpSuit) winnerValue += 13;
      if (this.contract.trumpSuit != "" && playedCard.suit == this.contract.trumpSuit) playerValue += 13;

      if (playedCard.suit == this.trickSuit) playerValue += 13;
      if (winnerCard.suit == this.trickSuit) winnerValue += 13;

      if (playerValue > winnerValue) {
        winner = player;
      }
    }

    winner.tricksWon += 1;

    // NEW: Add all cards from the trick to winner's captured pile
    for (const card of Object.values(this.trickPlayerCards)) {
      winner.capturedCards.push(new Card(card.rank, card.suit));
    }

    this.broadcast("tricksWon", { playerId: winner.id, card: this.trickPlayerCards[winner.id] });

    this.trickSuit = "";
    this.trickPlayerCards = {};
    this.cardPlayedUser = [];

    if (next) {
      let winnerIndex = this.state.turnOrder.indexOf(winner.id);
      let newOrder = this.rotateLeft(this.state.turnOrder.toArray(), winnerIndex);
      // console.log(newOrder);
      this.state.turnOrder.clear();
      this.state.turnOrder.push(...newOrder);

      this.state.currentTurnIndex = 0;
      console.log('🎯 Starting next trick');
      this.promptNextPlayer();
    }
  }

  rotateLeft(arr, n) {
    n = n % arr.length;
    return arr.slice(n).concat(arr.slice(0, n));
  }
  validateBid(player, bidType) {
    if (!Object.values(BID).includes(bidType)) {
      throw new Error('Invalid bid type!');
    }

    // Troel: must have 3 Aces in hand
    if (bidType === BID.Troel) {
      const aceCount = player.hand.filter(card => card.rank === 'A').length;
      if (aceCount < 3) {
        throw new Error('Troel requires 3 Aces!');
      }
    }

    // Meegaan: only valid if Vraag already declared
    if (bidType === BID.Meegaan) {
      const vraagExists = this.state.bids.some(b => b.bidType === BID.Vraag);
      if (!vraagExists) {
        throw new Error('Cannot Meegaan without Vraag!');
      }

      // Only one Meegaan allowed
      const meegaanCount = this.state.bids.filter(b => b.bidType === BID.Meegaan).length;
      if (meegaanCount >= 1) {
        throw new Error('Only one Meegaan allowed!');
      }
    }

    // Pico: no special validation here yet
    if (bidType === BID.Pico) {
      // optionally: nothing needed here during bidding
    }

    // Misere, OpenMisere, GeenDames, etc. might not need special validation at bidding
    // But you can add checks if you want!
  }
  resolveWinningBid() {
    // Sort by BID_PRIORITY
    const sortedBids = this.state.bids
      .filter(b => b.bidType !== BID.Pass)
      .sort((a, b) => BID_PRIORITY.indexOf(a.bidType) - BID_PRIORITY.indexOf(b.bidType));

    if (sortedBids.length === 0) {
      console.log('⚠️ All players passed!');
      return;
    }

    const winning = sortedBids[0];
    console.log(`🏆 Winning bid: Player ${winning.playerId} with ${winning.bidType}`);

    // Optionally store in state
    this.state.winningBid = winning;

    return winning;
  }
  configureContract() {
    const bid = this.state.winningBid;
    if (!bid) {
      console.warn('⚠️ No winning bid found. Skipping contract configuration.');
      return;
    }

    const bidType = bid.bidType;
    const bidderId = bid.playerId;

    // Store the contract configuration on room for easy access
    this.contract = {
      type: bidType,
      bidderId: bidderId,
      partners: [],
      trumpSuit: ""
    };

    // Default: use the dealer's last card as trump, if suit game
    if (
      bidType === BID.Vraag || 
      bidType === BID.Meegaan || 
      bidType === BID.AlleenGaan || 
      bidType === BID.Abondance || 
      bidType === BID.AbondanceInTroef || 
      bidType === BID.Troel
    ) {
      this.contract.trumpSuit = this.trumpCard.suit;
    }

    // Misere and OpenMisere have NO trump
    if (bidType === BID.Misere || bidType === BID.OpenMisere || bidType === BID.Pico || bidType === BID.GeenDames) {
      this.contract.trumpSuit = "";
    }

    // Handle partners
    if (bidType === BID.Vraag) {
      // Vraag + Meegaan = team
      const meegaanBid = Array.from(this.state.bids).find(b => b.bidType === BID.Meegaan);
      if (meegaanBid) {
        this.contract.partners = [bidderId, meegaanBid.playerId];
        console.log(`✅ Vraag/Meegaan team: ${bidderId} and ${meegaanBid.playerId}`);
      } else {
        // Edge case: no Meegaan accepted
        this.contract.partners = [bidderId];
        console.warn('⚠️ Vraag with no Meegaan. Solo play assumed.');
      }
    } else if (bidType === BID.Meegaan) {
      // Shouldn't happen alone, but safe fallback
      this.contract.partners = [bidderId];
    } else if (bidType === BID.AlleenGaan) {
      // Solo vs 3
      this.contract.partners = [bidderId];
    } else if (
      bidType === BID.Abondance || 
      bidType === BID.AbondanceInTroef || 
      bidType === BID.SoloSlim || 
      bidType === BID.Pico || 
      bidType === BID.Misere || 
      bidType === BID.OpenMisere || 
      bidType === BID.Troel
    ) {
      // Solo contracts
      this.contract.partners = [bidderId];
    }

    // Sync to state so clients see the contract
    this.state.contractType = this.contract.type;
    this.state.contractBidderId = this.contract.bidderId;
    this.state.contractPartners = new ArraySchema(...this.contract.partners);
    this.state.trumpSuit = this.contract.trumpSuit || "";
    console.log('✅ Contract configured:', this.contract);
  }
  scoreContract() {
    const contract = this.contract;
    if (!contract) {
      console.warn('⚠️ No contract found. Skipping scoring.');
      return;
    }

    const bidType = contract.type;
    console.log(`🧾 Scoring contract type: ${bidType}`);

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
        console.warn('⚠️ Unknown contract type. No scoring applied.');
        break;
    }
  }
  scoreVraagMeegaan() {
    let totalTricks = 0;
    for (const pid of this.contract.partners) {
      totalTricks += this.state.players.get(pid).tricksWon;
    }

    if (totalTricks >= 8) {
      for (const pid of this.contract.partners) {
        this.state.players.get(pid).score += 10;
        this.state.players.get(pid).roundscore = 10;
      }
      console.log(`✅ Vraag/Meegaan team succeeded! +10 each.`);
    } else {
      for (const pid of this.contract.partners) {
        this.state.players.get(pid).score -= 10;
        this.state.players.get(pid).roundscore = -10;
      }
      console.log(`❌ Vraag/Meegaan team failed. -10 each.`);
    }
  }
  scoreAlleenGaan() {
    const player = this.state.players.get(this.contract.bidderId);
    if (player.tricksWon >= 8) {
      player.score += 20;
      player.roundscore = 20;
      console.log(`✅ AlleenGaan success! +20`);
    } else {
      player.score -= 20;
      player.roundscore = -20;
      console.log(`❌ AlleenGaan failed. -20`);
    }
  }
  scoreMisere() {
    const player = this.state.players.get(this.contract.bidderId);
    if (player.tricksWon === 0) {
      player.score += 25;
      player.roundscore = +25;
      console.log(`✅ Misere success! +25`);
    } else {
      player.score -= 25;
      player.roundscore = -25;
      console.log(`❌ Misere failed. -25`);
    }
  }
  scorePico() {
    const player = this.state.players.get(this.contract.bidderId);
    if (player.tricksWon === 1) {
      player.score += 25;
      player.roundscore = +25;
      console.log(`✅ Pico success! +25`);
    } else {
      player.score -= 25;
      player.roundscore = -25;
      console.log(`❌ Pico failed. -25`);
    }
  }
  scoreGeenDames() {
    for (const player of this.state.players.values()) {
      let queenCount = player.capturedCards.filter(card => card.rank.toLowerCase() === 'queen').length;
      if (queenCount > 0) {
        const penalty = parseInt(queenCount * 20);
        player.score -= penalty;
        player.roundscore = -penalty;
        console.log(`❌ ${player.name} captured ${queenCount} Queen(s). -${penalty} points.`);
      } else {
        console.log(`✅ ${player.name} avoided all Queens! No penalty.`);
      }
    }
  }
  scoreTroel() {
    const player = this.state.players.get(this.contract.bidderId);
    if (player.tricksWon >= 10) {
      player.score += 30;
      player.roundscore = 30;
      console.log(`✅ Troel success! +30`);
    } else {
      player.score -= 30;
      player.roundscore = -30;
      console.log(`❌ Troel failed. -30`);
    }
  }
  scoreAbondance() {
    const player = this.state.players.get(this.contract.bidderId);
    if (player.tricksWon >= 9) {
      player.score += 40;
      player.roundscore = +40;
      console.log(`✅ Abondance success! +40`);
    } else {
      player.score -= 40;
      player.roundscore = -40;
      console.log(`❌ Abondance failed. -40`);
    }
  }
  scoreSoloSlim() {
    const player = this.state.players.get(this.contract.bidderId);
    if (player.tricksWon === 13) {
      player.score += 50;
      player.roundscore = +50;
      console.log(`✅ SoloSlim success! +50`);
    } else {
      player.score -= 50;
      player.roundscore = -50;
      console.log(`❌ SoloSlim failed. -50`);
    }
  }
}
