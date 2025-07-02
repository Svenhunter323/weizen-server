import { Room } from 'colyseus';
import {ArraySchema } from '@colyseus/schema';
import { WeizenState } from '../schema/WeizenState.js';
import { Player } from '../schema/Player.js';
import { Card } from '../schema/Card.js';

const PHASES = {
  WAITING: "waiting",
  DEALING: "dealing",
  BIDDING: "bidding",
  PLAYING: "playing",
  SCORING: "scoring"
};

const BID = {
  Pass: 0,
  GreenDames: 1,
  AlleenGaan: 2,
  Vraag_Meegaan: 3,
  Misere: 4,
  Pico: 5,
  Abondance: 6,
  SoloSlim: 7,
  Troel: 8,
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
    this.trumpCard = new Card("ace", "spades");

    this.onMessage("ready", (client, ready) => this.handleReady(client, ready));
    this.onMessage("deal", (client, ready) => this.handleDealReady(client, ready));
    this.onMessage("bid", (client, bid) => this.handleBid(client, bid));
    this.onMessage("playCard", (client, card) => this.handlePlayCard(client, card));
    this.onMessage("playCardReady", (client) => this.handlePlayCardReady(client));
  }

  async onAuth(client, options) {
    console.log(`🔐 Authenticating ${client.sessionId}`);
    // You could check a JWT or session token here
    return true;
  }

  onJoin(client, options) {
    console.log(`✅ Player joined: ${client.sessionId}`);

    if (this.state.players.size >= this.maxClients) {
      console.warn('❌ Room full');
      client.leave();
      return;
    }

    const player = new Player();
    player.id = client.sessionId;
    player.name = options.name || `Player-${this.state.players.size + 1}`;
    // player.seat = `Seat-${this.state.players.size + 1}`;
    player.seat = `${this.state.players.size}`;
    player.hand = new ArraySchema();
    player.bid = 0;
    player.tricksWon = 0;
    player.score = 0;

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
      player.hand = new ArraySchema(...hands[id]);
      player.bid = 0;
      player.tricksWon = 0;
      // console.log(player.hand.map(card => `${card.rank} of ${card.suit}`));
      console.log(`✅ Hand for ${player.name}:`, player.hand.map(card => `${card.rank} of ${card.suit}`));
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
    this.setupBiddingOrder();
    this.promptNextBidder();
  }

  setupBiddingOrder() {
    this.state.turnOrder = Array.from(this.state.players.keys());
    this.state.currentTurnIndex = 0;
  }

  promptNextBidder() {
    const currentId = this.state.turnOrder[this.state.currentTurnIndex];
    console.log(`🔔 Waiting for bid from: ${currentId}`);
    this.broadcast("promptBid", { playerId: currentId });
  }

  handleBid(client, bid) {
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.phase !== PHASES.BIDDING) return;

    player.bid = bid;
    this.broadcast("promptBidRes", { playerId: player.id, bid: bid });
    console.log(`✅ Received bid from ${player.name}: ${bid}`);

    this.state.currentTurnIndex++;
    if (this.state.currentTurnIndex >= this.state.turnOrder.length) {
      console.log('✅ Bidding complete');
      this.determinBiddingResult();
      this.startPlayPhase();
    } else {
      this.promptNextBidder();
    }
  }

  determinBiddingResult() {

  }

  startPlayPhase() {
    this.state.phase = PHASES.PLAYING;
    this.state.currentTurnIndex = 0;
    this.trickSuit = "";
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

    let a = [];
    
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
        this.scoreRound();
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
    this.state.phase = PHASES.SCORING;

    for (const [id, player] of this.state.players.entries()) {
      let scoreChange = 0;
      if (player.tricksWon >= player.bid) {
        scoreChange = 10;
        console.log(`🏆 ${player.name} met bid! +10`);
      } else {
        scoreChange = -5;
        console.log(`❌ ${player.name} failed bid. -5`);
      }
      player.score += scoreChange;
    }

    setTimeout(() => this.prepareNextRound(), 3000);
  }

  prepareNextRound() {
    console.log('🔄 Preparing next round');
    for (const player of this.state.players.values()) {
      player.bid = 0;
      player.tricksWon = 0;
      // player.hand = new ArraySchema();
      player.hand.clear();
    }
    this.startGame();
  }

  startNextTrick() {

    // who is won & refresh players score
    var winner = null;
    for (const [id, player] of this.state.players.entries()) {
      if (winner === null) {
        winner = player;
        continue;
      }
      let playedCard = this.trickPlayerCards[id];
      let winnerCard = this.trickPlayerCards[winner.id];

      let winnerRankVal = ranks.indexOf(winnerCard.rank);
      if (winnerCard.suit == this.trickSuit) winnerRankVal += 13;
      if (winnerCard.suit == this.trumpCard.suit) winnerRankVal += 13;

      let rankVal = ranks.indexOf(playedCard.rank);
      if (playedCard.suit == this.trickSuit) rankVal += 13;
      if (playedCard.suit == this.trumpCard.suit) rankVal += 13;
      if (rankVal > winnerRankVal) {
        winner = player;
      }      
    }

    winner.tricksWon += 1;
    this.broadcast("tricksWon", { playerId: winner.id, card: this.trickPlayerCards[winner.id] });

    this.trickSuit = "";
    this.trickPlayerCards = {};
    this.cardPlayedUser = [];

    let winnerIndex = this.state.turnOrder.indexOf(winner.id);
    this.rotateLeft(this.state.turnOrder, winnerIndex);
    this.state.currentTurnIndex = 0;
    console.log('🎯 Starting next trick');
    this.promptNextPlayer();
  }
  rotateLeft(arr, n) {
    n = n % arr.length;
    return arr.slice(n).concat(arr.slice(0, n));
  }
}
