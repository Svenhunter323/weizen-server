import { Room } from 'colyseus';
import { WeizenState } from '../schema/WeizenState.js';
import { Player } from '../schema/Player.js';

const PHASES = {
  WAITING: "waiting",
  DEALING: "dealing",
  BIDDING: "bidding",
  PLAYING: "playing",
  SCORING: "scoring"
};

export class WeizenRoom extends Room {
  onCreate(options) {
    console.log('✅ WeizenRoom created');
    this.state = new WeizenState();

    this.maxClients = 4;
    this.readyUser = {};
    this.dealReadyUser = {};

    this.onMessage("ready", (client, ready) => this.handleReady(client, ready));
    this.onMessage("deal", (client, ready) => this.handleDealReady(client, ready));
    this.onMessage("bid", (client, bid) => this.handleBid(client, bid));
    this.onMessage("playCard", (client, card) => this.handlePlayCard(client, card));
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
    player.seat = `${this.state.players.size + 1}`;
    player.hand = [];
    player.bid = -1;
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

    console.log(`✅ Player Ready: ${client.sessionId}\n current: ${this.state.players.size}\n max: ${this.state.players.size}`);
    
    if (this.state.players.size === this.maxClients) {
      if (keys.length === this.maxClients) {
        this.startGame();
      }
    }
  }

  handleDealReady(client, ready) {
    this.dealReadyUser[client.sessionId] = ready;

    var keys = Object.keys(this.dealReadyUser);

    if (this.state.players.size === this.maxClients) {
      if (keys.length === this.maxClients) {
        this.startBidding();
      }
    }
  }

  startGame() {
    console.log('✅ Starting game...');

    this.dealCards();
    this.state.phase = PHASES.DEALING;
  }

  dealCards() {
    console.log('🃏 Dealing cards...');
    const deck = this.generateDeck();
    this.shuffle(deck);
    const lastCard = deck[deck.length - 1];
    const trump_suit = lastCard.split("_")[1];
    const hands = this.dealToPlayers(deck);

    for (const [id, player] of this.state.players.entries()) {
      // player.hand = hands[id];
      this.safeAssignHand(player, hands[id]);
      player.bid = -1;
      player.tricksWon = 0;
      console.log(`✅ Hand for ${player.name}:`, player.hand.items);
    }
  }
  safeAssignHand(player, newHand) {
    console.log(`🟢 [AssignHand] Player ${player.id}:`, newHand);

    if (!Array.isArray(newHand)) {
      console.error(`❌ [ERROR] player.hand assigned NON-ARRAY value for player ${player.id}:`, newHand);
      newHand = [];  // fail-safe
    } else {
      for (let i = 0; i < newHand.length; i++) {
        if (typeof newHand[i] !== 'string') {
          console.error(`❌ [ERROR] player.hand contains NON-STRING at index ${i}:`, newHand[i]);
        }
      }
    }

    player.hand = newHand;
  }

  safePushHand(player, card) {
    if (typeof card !== 'string') {
      console.error(`❌ [ERROR] Attempting to push NON-STRING card for player ${player.id}:`, card);
      return;
    }
    player.hand.push(card);
    console.log(`🟢 [PushHand] Player ${player.id} now has:`, player.hand);
  }
  
  generateDeck() {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const ranks = ['2', '3', '4', '5', '6','7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
    return suits.flatMap(suit => ranks.map(rank => `${rank}_${suit}`));
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
    this.setupBiddingOrder();
    this.state.phase = PHASES.BIDDING;
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
    console.log(`✅ Received bid from ${player.name}: ${bid}`);

    this.state.currentTurnIndex++;
    if (this.state.currentTurnIndex >= this.state.turnOrder.length) {
      console.log('✅ Bidding complete');
      this.startPlayPhase();
    } else {
      this.promptNextBidder();
    }
  }

  startPlayPhase() {
    this.state.phase = PHASES.PLAYING;
    this.state.currentTurnIndex = 0;
    console.log('🎮 Play phase started');
    this.promptNextPlayer();
  }

  promptNextPlayer() {
    const currentId = this.state.turnOrder[this.state.currentTurnIndex];
    console.log(`🔔 Waiting for move from: ${currentId}`);
    this.broadcast("promptPlay", { playerId: currentId });
  }

  handlePlayCard(client, card) {
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.phase !== PHASES.PLAYING) return;

    console.log(`✅ ${player.name} played ${card}`);
    player.hand = player.hand.filter(c => c !== card);
    player.tricksWon += 1; // Simplified trick count

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
      player.bid = -1;
      player.tricksWon = 0;
      player.hand = [];
    }
    this.startGame();
  }

  startNextTrick() {
    this.state.currentTurnIndex = 0;
    console.log('🎯 Starting next trick');
    this.promptNextPlayer();
  }
}
