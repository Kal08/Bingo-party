
import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  onSnapshot, 
  arrayUnion,
  increment
} from 'firebase/firestore';
import { 
  Play, 
  Users, 
  Trophy, 
  Hash, 
  Loader2, 
  Copy, 
  CheckCircle2, 
  Crown,
  Shuffle,
  RotateCcw
} from 'lucide-react';

// --- Firebase Initialization ---
const firebaseConfig = {
  apiKey: "AIzaSyBVc4acaqoLG4rhLgYEeb4OlOBmELv5y9E",
  authDomain: "bingo-party-14cc2.firebaseapp.com",
  projectId: "bingo-party-14cc2",
  storageBucket: "bingo-party-14cc2.firebasestorage.app",
  messagingSenderId: "760917990875",
  appId: "1:760917990875:web:b9b44d07a405a60d795bfe"
};

// --- Constants & Utilities ---
const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'];
const COL_RANGES = {
  0: { min: 1, max: 15 },
  1: { min: 16, max: 30 },
  2: { min: 31, max: 45 },
  3: { min: 46, max: 60 },
  4: { min: 61, max: 75 },
};

// Generate a random ID for the game room
const generateRoomId = () => Math.random().toString(36).substring(2, 6).toUpperCase();

// Generate a valid Bingo board
const generateBoard = () => {
  const board = Array(25).fill(null);
  for (let col = 0; col < 5; col++) {
    const range = COL_RANGES[col];
    const nums = new Set();
    while (nums.size < 5) {
      nums.add(Math.floor(Math.random() * (range.max - range.min + 1)) + range.min);
    }
    const colNums = Array.from(nums);
    for (let row = 0; row < 5; row++) {
      if (col === 2 && row === 2) {
        board[row * 5 + col] = 0; // Free space
      } else {
        board[row * 5 + col] = colNums[row];
      }
    }
  }
  return board;
};

// Check for win
const checkWin = (marks) => {
  const isMarked = (idx) => marks.includes(idx);
  
  // Rows
  for (let r = 0; r < 5; r++) {
    if ([0,1,2,3,4].every(c => isMarked(r * 5 + c))) return true;
  }
  // Cols
  for (let c = 0; c < 5; c++) {
    if ([0,1,2,3,4].every(r => isMarked(r * 5 + c))) return true;
  }
  // Diagonals
  if ([0,1,2,3,4].every(i => isMarked(i * 5 + i))) return true;
  if ([0,1,2,3,4].every(i => isMarked(i * 5 + (4 - i)))) return true;

  return false;
};

export default function BingoGame() {
  const [user, setUser] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [view, setView] = useState('welcome'); // welcome, lobby, game
  const [gameId, setGameId] = useState('');
  const [gameData, setGameData] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  // --- Auth & Setup ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth failed:", err);
        setError("Authentication failed. Please refresh.");
      }
    };
    initAuth();
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  // --- Firestore Listeners ---
  useEffect(() => {
    if (!user || !gameId) return;

    // RULE 1: Strict path usage
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);

    const unsubscribe = onSnapshot(gameRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setGameData(data);
        
        // Auto-navigate based on status
        if (data.status === 'playing' && view === 'lobby') {
          setView('game');
        }
        if (data.status === 'finished' && view === 'game') {
          // Stay on game view but show winner overlay
        }
      } else {
        setError("Game room not found or closed.");
        setView('welcome');
      }
    }, (err) => {
      console.error("Game listener error:", err);
      setError("Connection lost.");
    });

    return () => unsubscribe();
  }, [user, gameId, view]);

  // --- Actions ---

  const handleCreateGame = async () => {
    if (!playerName.trim()) return setError("Please enter your name.");
    setLoading(true);
    const newRoomId = generateRoomId();
    const board = generateBoard();

    const initialGameData = {
      createdAt: new Date().toISOString(),
      hostId: user.uid,
      status: 'lobby', // lobby, playing, finished
      currentNumber: null,
      drawnNumbers: [], // The history of drawn numbers
      winner: null,
      players: {
        [user.uid]: {
          name: playerName,
          board: board,
          marks: [12] // Center free space index
        }
      }
    };

    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', newRoomId), initialGameData);
      setGameId(newRoomId);
      setView('lobby');
    } catch (err) {
      console.error(err);
      setError("Failed to create game.");
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGame = async () => {
    if (!playerName.trim()) return setError("Please enter your name.");
    if (!joinCode.trim()) return setError("Please enter a room code.");
    setLoading(true);
    const code = joinCode.toUpperCase();

    try {
      const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', code);
      const docSnap = await getDoc(gameRef);

      if (!docSnap.exists()) {
        throw new Error("Room not found.");
      }

      const data = docSnap.data();
      if (data.status !== 'lobby') {
         // Allow re-joining if already in player list
         if (!data.players[user.uid]) {
            throw new Error("Game already started.");
         }
      }

      // If not already in game, add player
      if (!data.players[user.uid]) {
        const board = generateBoard();
        await updateDoc(gameRef, {
          [`players.${user.uid}`]: {
            name: playerName,
            board: board,
            marks: [12] // Free space
          }
        });
      }

      setGameId(code);
      setView(data.status === 'playing' ? 'game' : 'lobby');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartGame = async () => {
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId), {
        status: 'playing'
      });
    } catch (err) {
      setError("Could not start game.");
    }
  };

  const handleDrawNumber = async () => {
    if (!gameData || gameData.hostId !== user.uid) return;
    if (gameData.winner) return;

    // Calculate available numbers
    const allNums = Array.from({length: 75}, (_, i) => i + 1);
    const drawn = new Set(gameData.drawnNumbers || []);
    const available = allNums.filter(n => !drawn.has(n));

    if (available.length === 0) return;

    const nextNum = available[Math.floor(Math.random() * available.length)];

    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId), {
      currentNumber: nextNum,
      drawnNumbers: arrayUnion(nextNum)
    });
  };

  const handleMarkCell = async (cellIndex, number) => {
    if (gameData.status !== 'playing') return;
    
    // Validate: Is this number actually drawn? OR is it the free space?
    // We allow marking freely for fun, but win check validates against drawn numbers strictly.
    // Actually, to prevent confusion, let's only allow marking if it has been drawn.
    const isFreeSpace = cellIndex === 12;
    const isDrawn = gameData.drawnNumbers.includes(number);

    if (!isFreeSpace && !isDrawn) return; // Can't mark undrawn numbers

    const myData = gameData.players[user.uid];
    const currentMarks = myData.marks || [];
    
    let newMarks;
    if (currentMarks.includes(cellIndex)) {
      newMarks = currentMarks.filter(i => i !== cellIndex); // Toggle off
    } else {
      newMarks = [...currentMarks, cellIndex]; // Toggle on
    }

    // Optimistic update local check then firestore
    const won = checkWin(newMarks);
    
    // Update Firestore
    const updates = {
      [`players.${user.uid}.marks`]: newMarks
    };

    if (won && !gameData.winner) {
      updates.winner = myData.name;
      updates.status = 'finished';
    }

    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId), updates);
  };

  const handleRestart = async () => {
    if (gameData.hostId !== user.uid) return;
    
    // Reset game state but keep players
    const updates = {
      status: 'lobby',
      currentNumber: null,
      drawnNumbers: [],
      winner: null
    };

    // Reset marks for all players
    Object.keys(gameData.players).forEach(uid => {
      updates[`players.${uid}.marks`] = [12];
      // Optionally generate new boards? Let's keep boards for simplicity or regenerate.
      // Let's regenerate to keep it fresh.
      updates[`players.${uid}.board`] = generateBoard();
    });

    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId), updates);
    setView('lobby');
  };

  // --- Views ---

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  // 1. Welcome Screen
  if (view === 'welcome') {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-800 p-8 rounded-2xl shadow-xl border border-slate-700">
          <div className="text-center mb-8">
            <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400 mb-2">BINGO</h1>
            <p className="text-slate-400">Multiplayer Party Game</p>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Your Name</label>
              <input 
                type="text" 
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Enter nickname..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-600 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={handleCreateGame}
                disabled={loading}
                className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-900 font-bold py-3 px-4 rounded-xl transition-all"
              >
                {loading ? <Loader2 className="animate-spin w-5 h-5"/> : <Play className="w-5 h-5" />}
                Host
              </button>
              <button 
                onClick={() => document.getElementById('join-section').classList.toggle('hidden')}
                className="flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 px-4 rounded-xl transition-all"
              >
                <Users className="w-5 h-5" />
                Join
              </button>
            </div>

            <div id="join-section" className="hidden animate-in fade-in slide-in-from-top-4 pt-4 border-t border-slate-700">
              <label className="block text-sm font-medium text-slate-400 mb-2">Room Code</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="ABCD"
                  maxLength={4}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-600 focus:ring-2 focus:ring-emerald-500 outline-none font-mono uppercase tracking-widest"
                />
                <button 
                  onClick={handleJoinGame}
                  disabled={loading}
                  className="bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 font-bold px-6 rounded-lg transition-all"
                >
                  GO
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm text-center">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 2. Lobby Screen
  if (view === 'lobby' && gameData) {
    const isHost = gameData.hostId === user.uid;
    const playersList = Object.values(gameData.players);

    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 p-6 flex flex-col items-center">
        <div className="max-w-2xl w-full space-y-8">
          
          <div className="text-center space-y-4">
            <h2 className="text-3xl font-bold">Lobby</h2>
            <div className="inline-flex items-center gap-4 bg-slate-800 p-4 rounded-2xl border border-slate-700 shadow-lg">
              <div className="text-left">
                <p className="text-xs text-slate-500 uppercase tracking-wider font-bold">Room Code</p>
                <p className="text-4xl font-mono font-black text-emerald-400 tracking-widest">{gameId}</p>
              </div>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(gameId);
                  // Quick feedback could go here
                }}
                className="p-3 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white"
              >
                <Copy className="w-6 h-6" />
              </button>
            </div>
          </div>

          <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
            <div className="p-4 bg-slate-800/50 border-b border-slate-700 flex justify-between items-center">
              <h3 className="font-bold flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-400" />
                Players ({playersList.length})
              </h3>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              {playersList.map((p, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-lg">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                    p.name === gameData.players[gameData.hostId]?.name ? 'bg-amber-500 text-slate-900' : 'bg-slate-700 text-slate-300'
                  }`}>
                    {p.name[0].toUpperCase()}
                  </div>
                  <span className="font-medium truncate">{p.name}</span>
                  {p.name === gameData.players[gameData.hostId]?.name && <Crown className="w-4 h-4 text-amber-500 ml-auto" />}
                </div>
              ))}
            </div>
          </div>

          {isHost ? (
            <button 
              onClick={handleStartGame}
              className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-slate-900 font-bold text-xl rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-3"
            >
              <Play className="w-6 h-6" />
              Start Game
            </button>
          ) : (
            <div className="text-center p-4 text-slate-500 animate-pulse">
              Waiting for host to start...
            </div>
          )}
        </div>
      </div>
    );
  }

  // 3. Game Screen
  if (view === 'game' && gameData) {
    const isHost = gameData.hostId === user.uid;
    const myData = gameData.players[user.uid];
    const myMarks = myData?.marks || [];
    const latestNum = gameData.currentNumber;
    
    // Determine letter for current number (1-15 B, etc)
    const getLetter = (n) => {
      if (!n) return '';
      if (n <= 15) return 'B';
      if (n <= 30) return 'I';
      if (n <= 45) return 'N';
      if (n <= 60) return 'G';
      return 'O';
    };

    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col md:flex-row overflow-hidden">
        
        {/* Winner Overlay */}
        {gameData.winner && (
          <div className="absolute inset-0 z-50 bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-slate-800 p-8 rounded-3xl border-2 border-amber-500/50 shadow-2xl shadow-amber-500/20 text-center max-w-lg w-full transform animate-in zoom-in-95 duration-300">
              <Trophy className="w-24 h-24 mx-auto text-amber-400 mb-6 animate-bounce" />
              <h2 className="text-5xl font-black text-white mb-2">BINGO!</h2>
              <p className="text-2xl text-slate-300 mb-8">
                <span className="text-amber-400 font-bold">{gameData.winner}</span> won the game!
              </p>
              {isHost ? (
                <button 
                  onClick={handleRestart}
                  className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-slate-900 font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-5 h-5" />
                  Play Again
                </button>
              ) : (
                <div className="text-slate-500">Waiting for host to restart...</div>
              )}
            </div>
          </div>
        )}

        {/* Sidebar (Host Controls & History) */}
        <div className="md:w-80 bg-slate-800 border-r border-slate-700 flex flex-col h-[30vh] md:h-screen order-1 md:order-2">
          {/* Current Call */}
          <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-800 relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-500/10 via-transparent to-transparent"></div>
            <h3 className="text-slate-400 text-sm font-bold uppercase tracking-wider mb-2">Current Ball</h3>
            
            {latestNum ? (
              <div className="relative group">
                <div className="w-32 h-32 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shadow-2xl shadow-emerald-500/20 transform transition-transform group-hover:scale-105">
                  <div className="text-center">
                    <div className="text-xl font-bold text-emerald-900 opacity-75">{getLetter(latestNum)}</div>
                    <div className="text-6xl font-black text-white leading-none">{latestNum}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="w-32 h-32 rounded-full border-4 border-dashed border-slate-600 flex items-center justify-center">
                <span className="text-slate-600 font-bold">READY</span>
              </div>
            )}

            {isHost && !gameData.winner && (
              <button 
                onClick={handleDrawNumber}
                className="mt-8 w-full max-w-[200px] bg-emerald-500 hover:bg-emerald-600 text-slate-900 font-bold py-3 px-6 rounded-xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <Shuffle className="w-5 h-5" />
                Draw Number
              </button>
            )}
            
            {!isHost && !gameData.winner && (
               <p className="mt-4 text-sm text-slate-500 text-center animate-pulse">Waiting for host...</p>
            )}
          </div>

          {/* History */}
          <div className="h-1/3 md:h-1/2 border-t border-slate-700 p-4 overflow-hidden flex flex-col">
             <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                <Hash className="w-4 h-4" /> Recent Calls
             </h4>
             <div className="flex flex-wrap gap-2 content-start overflow-y-auto custom-scrollbar">
                {gameData.drawnNumbers.slice().reverse().map((n, i) => (
                  <span key={i} className={`px-3 py-1 rounded-full text-sm font-bold border ${i===0 ? 'bg-white text-slate-900 border-white' : 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                    {getLetter(n)}-{n}
                  </span>
                ))}
             </div>
          </div>
        </div>

        {/* Main Area (Board) */}
        <div className="flex-1 bg-slate-900 p-4 md:p-8 flex flex-col items-center justify-center order-2 md:order-1 overflow-y-auto">
          
          <div className="max-w-xl w-full">
            <div className="flex justify-between items-end mb-4">
              <div>
                <h2 className="text-2xl font-bold text-white">{myData.name}'s Board</h2>
                <p className="text-slate-400 text-sm">Room: {gameId}</p>
              </div>
              <div className="text-right">
                 <div className="text-xs text-slate-500 font-bold uppercase">Players</div>
                 <div className="text-xl font-mono text-emerald-400">{Object.keys(gameData.players).length}</div>
              </div>
            </div>

            {/* BINGO GRID */}
            <div className="bg-slate-800 p-4 rounded-2xl shadow-2xl border border-slate-700">
              {/* Header Row */}
              <div className="grid grid-cols-5 gap-2 mb-2">
                {BINGO_LETTERS.map((l, i) => (
                   <div key={l} className="h-12 flex items-center justify-center text-2xl font-black text-slate-600 bg-slate-900 rounded-lg border border-slate-700/50">
                     {l}
                   </div>
                ))}
              </div>

              {/* Numbers Grid */}
              <div className="grid grid-cols-5 gap-2">
                {myData.board.map((num, idx) => {
                  const isMarked = myMarks.includes(idx);
                  const isFree = idx === 12;
                  const isDrawn = gameData.drawnNumbers.includes(num);
                  const canClick = isFree || isDrawn;

                  return (
                    <button
                      key={idx}
                      onClick={() => handleMarkCell(idx, num)}
                      disabled={!canClick || gameData.winner}
                      className={`
                        aspect-square rounded-xl flex items-center justify-center text-xl md:text-2xl font-bold transition-all duration-200
                        ${isFree ? 'bg-emerald-900/30 border-2 border-emerald-500/50 text-emerald-400' : ''}
                        ${!isFree && isMarked ? 'bg-emerald-500 text-slate-900 shadow-lg scale-95' : ''}
                        ${!isFree && !isMarked && canClick ? 'bg-slate-700 hover:bg-slate-600 text-white cursor-pointer hover:scale-105' : ''}
                        ${!isFree && !isMarked && !canClick ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed' : ''}
                      `}
                    >
                      {isFree ? (
                        <CheckCircle2 className="w-8 h-8" />
                      ) : (
                        num
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 text-center text-slate-500 text-sm">
               Matched 5 in a row/column/diagonal to win!
            </div>
          </div>
        </div>

      </div>
    );
  }

  return null;
}