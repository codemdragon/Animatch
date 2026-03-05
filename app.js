// ===== AniMatch V3 — Application Logic =====

// --- State ---
const state = {
    animeList: [], index: 0,
    watchlist: [],
    likedAnime: [],
    skippedIds: [],
    stats: {
        totalSwipes: 0, totalLikes: 0, totalSkips: 0,
        genreLikes: {}, typeLikes: {}, genreSkips: {}, typeSkips: {},
        ratingsGiven: 0, discoveries: 0
    },
    privacyAccepted: false,
    preferences: { genre: {}, type: {}, scoreBias: 7 },
    streak: { current: 0, lastDate: null, bestStreak: 0 },
    achievements: [
        { id: 'first_like', title: 'First Like', icon: 'favorite', desc: 'Like your first anime', unlocked: false, goal: 1, stat: 'totalLikes' },
        { id: 'explorer', title: 'Explorer', icon: 'travel_explore', desc: '25 total swipes', unlocked: false, goal: 25, stat: 'totalSwipes' },
        { id: 'romantic', title: 'Romantic', icon: 'favorite_border', desc: 'Like 5 Romance anime', unlocked: false, goal: 5, stat: 'genre_Romance' },
        { id: 'action_hero', title: 'Action Hero', icon: 'bolt', desc: 'Like 5 Action anime', unlocked: false, goal: 5, stat: 'genre_Action' },
        { id: 'critic', title: 'Critic', icon: 'star', desc: 'Rate 10 anime', unlocked: false, goal: 10, stat: 'ratingsGiven' },
        { id: 'marathoner', title: 'Marathoner', icon: 'playlist_add_check', desc: '20 in watchlist', unlocked: false, goal: 20, stat: 'watchlistCount' },
        { id: 'collector', title: 'Collector', icon: 'bookmark', desc: '10 in watchlist', unlocked: false, goal: 10, stat: 'watchlistCount' },
        { id: 'scout', title: 'Scout', icon: 'search', desc: 'Use search or filters', unlocked: false, goal: 1, stat: 'manual' },
        { id: 'binge_king', title: 'Binge King', icon: 'local_fire_department', desc: '50 likes', unlocked: false, goal: 50, stat: 'totalLikes' },
        { id: 'genre_master', title: 'Genre Master', icon: 'category', desc: 'Like 5+ different genres', unlocked: false, goal: 5, stat: 'genreVariety' },
        { id: 'completionist', title: 'Completionist', icon: 'done_all', desc: 'Complete 10 anime', unlocked: false, goal: 10, stat: 'completedCount' },
        { id: 'streak_lord', title: 'Streak Lord', icon: 'whatshot', desc: '7-day streak', unlocked: false, goal: 7, stat: 'streakBest' }
    ],
    theme: 'dark',
    currentPage: 1, hasMorePages: true,
    smartMode: false, sortMode: 'recent',
    activeStatusFilter: 'all'
};

// --- DOM ---
const $ = id => document.getElementById(id);
const cardStack = $('cardStack'), loader = $('globalLoader'), actionBar = $('actionBar');
const searchInput = $('searchInput'), genreSelect = $('genreSelect'), listFilter = $('listFilterInput');
const modal = $('detailsModal'), modalImg = $('modalImg'), modalTitle = $('modalTitle');
const modalDesc = $('modalDesc'), modalGenres = $('modalGenres');
const modalLikeBtn = $('modalLikeBtn'), modalListBtn = $('modalListBtn');
const modalScore = $('modalScore'), quickActions = $('quickActions');
let currentModalAnime = null;
let fetchTimeout, isFetching = false;
let seenIds = new Set(); // Loaded from IndexedDB
let isPreloading = false;
const SEEN_LIMIT = 5000; // Max seen IDs to store
const PRELOAD_THRESHOLD = 5; // Preload next page when this many cards left

// --- IndexedDB for Seen Anime ---
const IDB_NAME = 'animatch_seen';
const IDB_STORE = 'ids';
let idb = null;

function openIDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => { idb = req.result; resolve(idb); };
        req.onerror = () => reject(req.error);
    });
}

async function loadSeenIds() {
    try {
        await openIDB();
        const tx = idb.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const all = await idbGetAll(store);
        seenIds = new Set(all.map(r => r.id));
    } catch (e) { console.warn('IDB load failed, using memory only', e); }
}

function idbGetAll(store) {
    return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function markSeen(malId) {
    seenIds.add(malId);
    if (!idb) return;
    try {
        const tx = idb.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.put({ id: malId, ts: Date.now() });
        // Evict oldest if over limit
        if (seenIds.size > SEEN_LIMIT) {
            const allReq = store.getAll();
            allReq.onsuccess = () => {
                const all = allReq.result.sort((a, b) => a.ts - b.ts);
                const toDelete = all.slice(0, all.length - SEEN_LIMIT);
                const tx2 = idb.transaction(IDB_STORE, 'readwrite');
                const s2 = tx2.objectStore(IDB_STORE);
                toDelete.forEach(r => { s2.delete(r.id); seenIds.delete(r.id); });
            };
        }
    } catch (e) { }
}

// --- Init ---
async function init() {
    loadData();
    await loadSeenIds();
    updateStreak();
    setupNav();
    setupInputs();
    setupModalEvents();
    setupThemeToggle();
    setupQuickActions();
    renderAchievements();
    updateLevelDisplay();

    // Privacy Check
    if (!state.privacyAccepted) {
        const pm = $('privacyModal');
        pm.style.display = 'flex';
        pm.style.opacity = '0';
        pm.style.pointerEvents = 'none';
        // Use rAF so display:flex is painted before the opacity transition starts.
        // Without this, Android WebView composites both changes in the same frame
        // and the transition never fires — making the modal invisible.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                pm.style.opacity = '1';
                pm.style.pointerEvents = 'all';
            });
        });
        $('btnAcceptPrivacy').onclick = () => {
            state.privacyAccepted = true;
            saveData();
            pm.style.opacity = '0';
            pm.style.pointerEvents = 'none';
            setTimeout(() => pm.style.display = 'none', 300);
        };
    }

    // Always pre-load the first stack of anime
    fetchAnime();
}

// --- Streak ---
function updateStreak() {
    const today = new Date().toISOString().split('T')[0];
    if (state.streak.lastDate === today) return;
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (state.streak.lastDate === yesterday) {
        state.streak.current++;
    } else if (state.streak.lastDate !== today) {
        state.streak.current = 1;
    }
    state.streak.lastDate = today;
    state.streak.bestStreak = Math.max(state.streak.bestStreak, state.streak.current);
    checkAchievements();
    saveData();
}

// --- Fetching ---
function debounceFetch() {
    if (isFetching) return;
    clearTimeout(fetchTimeout);
    fetchTimeout = setTimeout(() => { state.currentPage = 1; state.hasMorePages = true; fetchAnime(); }, 600);
}

// Fetch helper with retry for Jikan API rate limits (429)
async function fetchWithRetry(url, retries = 2, delay = 1000) {
    for (let i = 0; i <= retries; i++) {
        const res = await fetch(url);
        if (res.ok) return res.json();

        if (res.status === 429) {
            if (i < retries) {
                showToast(`Rate limited. Retrying in ${delay / 1000}s...`, 'hourglass_empty');
                await new Promise(r => setTimeout(r, delay));
                delay *= 2; // Exponential backoff
            } else {
                throw new Error('Rate limit exceeded. Please try again later.');
            }
        } else {
            throw new Error(`API Error: ${res.status}`);
        }
    }
}

async function fetchAnime(append = false) {
    const query = searchInput.value.trim();
    const genre = genreSelect.value;
    let url;
    if (state.smartMode) {
        url = buildSmartUrl();
    } else if (query) {
        url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=20&sfw=true&page=${state.currentPage}`;
        if (genre) url += `&genres=${genre}`;
    } else if (genre) {
        url = `https://api.jikan.moe/v4/anime?genres=${genre}&order_by=score&sort=desc&limit=20&sfw=true&page=${state.currentPage}`;
    } else {
        url = `https://api.jikan.moe/v4/top/anime?filter=airing&limit=20&sfw=true&page=${state.currentPage}`;
    }

    if (!navigator.onLine) {
        cardStack.innerHTML = `
            <div class="empty">
                <span class="material-icons-round" style="font-size:3rem;color:var(--text-sec)">wifi_off</span><br>
                <span>Discover requires internet.</span><br>
                <button onclick="switchToView('view-list')" class="btn-smart" style="margin-top:15px">View My List</button>
            </div>`;
        actionBar.classList.add('hidden');
        return;
    }

    isFetching = true;
    loader.classList.add('active');
    try {
        const data = await fetchWithRetry(url);
        let results = data.data || [];
        state.hasMorePages = data.pagination?.has_next_page || false;

        // Filter out already-seen anime
        results = results.filter(a => !seenIds.has(a.mal_id));

        if (state.smartMode && results.length) {
            results = rankByPreference(results);
        }

        if (append) {
            state.animeList = state.animeList.concat(results);
        } else {
            state.animeList = results;
            state.index = 0;
        }
        renderCardStack();
        updateActionBar();
        if (query || genre) unlockManual('scout');
    } catch (err) {
        console.error(err);
        const msg = err.message.includes('Rate limit') ? err.message : 'Error loading. Please wait a moment!';
        showToast(msg, 'error_outline');
        if (!state.animeList.length) {
            cardStack.innerHTML = `<div class="empty"><span class="material-icons-round" style="font-size:3rem;color:var(--text-sec)">error_outline</span><br>${msg}</div>`;
        }
    } finally {
        isFetching = false;
        loader.classList.remove('active');
    }
}

async function fetchSurpriseAnime() {
    if (isFetching) return;
    isFetching = true;
    loader.classList.add('active');
    state.smartMode = false;
    $('btnSmartMatch').classList.remove('active-mode');
    try {
        const page = Math.floor(Math.random() * 10) + 1;
        const data = await fetchWithRetry(`https://api.jikan.moe/v4/top/anime?page=${page}&limit=20&sfw=true`);
        state.animeList = (data.data || []).sort(() => Math.random() - 0.5);
        state.index = 0;
        renderCardStack();
        updateActionBar();
        showToast('🎲 Random picks loaded!', 'casino');
        switchToView('view-discover');
    } catch (err) {
        const msg = err.message.includes('Rate limit') ? err.message : 'Error loading random anime';
        showToast(msg, 'error_outline');
    } finally {
        isFetching = false;
        loader.classList.remove('active');
    }
}

// --- Smart Recommendation ---
function buildSmartUrl() {
    const topGenres = Object.entries(state.preferences.genre).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const genreMap = { Action: 1, Adventure: 2, Comedy: 4, Drama: 8, Fantasy: 10, Horror: 14, Isekai: 62, Mystery: 7, Romance: 22, 'Sci-Fi': 24, 'Slice of Life': 36, Sports: 30, Supernatural: 37, Thriller: 41 };

    // Pick ONE random top genre to prevent over-filtering (Jikan treats multiple genres as AND)
    const randomTopGenre = topGenres.length ? topGenres[Math.floor(Math.random() * topGenres.length)] : null;
    let url = `https://api.jikan.moe/v4/anime?order_by=score&sort=desc&limit=20&sfw=true&page=${state.currentPage}`;

    if (randomTopGenre) {
        const genreId = genreMap[randomTopGenre[0]];
        if (genreId) url += `&genres=${genreId}`;
    }

    // Ensure min_score is an integer and maxes out at 7 to prevent 0 results
    if (state.preferences.scoreBias > 6) {
        url += `&min_score=${Math.min(7, Math.floor(state.preferences.scoreBias - 2))}`;
    }
    return url;
}

function rankByPreference(animeList) {
    const likedIds = new Set(state.likedAnime.map(a => a.mal_id));
    const skippedSet = new Set(state.skippedIds);
    return animeList
        .filter(a => !likedIds.has(a.mal_id) && !skippedSet.has(a.mal_id))
        .filter(a => {
            // Dislike Detection
            const genres = (a.genres || []).map(g => g.name);
            const type = a.type || '';
            let isHeavilyDisliked = false;

            genres.forEach(g => {
                const likes = state.stats.genreLikes[g] || 0;
                const skips = state.stats.genreSkips[g] || 0;
                if (skips >= 5 && (likes === 0 || likes / (likes + skips) < 0.15)) isHeavilyDisliked = true;
            });

            const tLikes = state.stats.typeLikes[type] || 0;
            const tSkips = state.stats.typeSkips[type] || 0;
            if (tSkips >= 5 && (tLikes === 0 || tLikes / (tLikes + tSkips) < 0.15)) isHeavilyDisliked = true;

            // Strict avoidance: heavily disliked items only pass 1 in 40 times (2.5%)
            if (isHeavilyDisliked) return Math.random() <= 0.025;
            return true;
        })
        .map(a => {
            let score = 0;
            const genres = (a.genres || []).map(g => g.name);
            genres.forEach(g => {
                score += (state.preferences.genre[g] || 0) * 3;
                score -= (state.stats.genreSkips[g] || 0) * 0.5; // Slight penalty
            });
            if (a.score) score += (a.score / 10) * 20;
            const type = a.type || '';
            score += (state.preferences.type[type] || 0);
            score -= (state.stats.typeSkips[type] || 0) * 0.5;
            a._matchScore = score;
            a._matchReason = buildMatchReason(genres, a.score, type);
            return a;
        })
        .sort((a, b) => b._matchScore - a._matchScore);
}

function buildMatchReason(genres, score, type) {
    const parts = [];
    const topPrefGenres = Object.entries(state.preferences.genre).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
    const matched = genres.filter(g => topPrefGenres.includes(g));
    if (matched.length) parts.push(`You like ${matched.join(' & ')}`);
    if (score >= 8) parts.push('Highly rated');
    if (state.preferences.type[type] > 2) parts.push(`${type} fan`);
    return parts.length ? parts.join(' • ') : 'Explore something new!';
}

function updatePreferences(anime) {
    (anime.genres || []).forEach(g => {
        state.preferences.genre[g.name] = (state.preferences.genre[g.name] || 0) + 1;
        state.stats.genreLikes[g.name] = (state.stats.genreLikes[g.name] || 0) + 1;
    });
    if (anime.type) {
        state.preferences.type[anime.type] = (state.preferences.type[anime.type] || 0) + 1;
        state.stats.typeLikes[anime.type] = (state.stats.typeLikes[anime.type] || 0) + 1;
    }
    if (anime.score) {
        const scores = state.likedAnime.map(a => a.score).filter(Boolean);
        scores.push(anime.score);
        state.preferences.scoreBias = scores.reduce((s, v) => s + v, 0) / scores.length;
    }
}

// --- Card Rendering ---
function renderCardStack() {
    cardStack.innerHTML = '';

    // If we've run out of cards (e.g. filtered by heavily disliked or seen IDs), auto-fetch next page
    if ((!state.animeList.length || state.index >= state.animeList.length) && state.hasMorePages) {
        state.currentPage++;
        fetchAnime(true);
        return;
    }

    if (!state.animeList.length || state.index >= state.animeList.length) {
        cardStack.innerHTML = '<div class="empty"><span class="material-icons-round" style="font-size:3rem;color:var(--primary-light)">check_circle</span><br>No more results found! Try a different search.</div>';
        return;
    }

    const anime = state.animeList[state.index];
    const card = createCard(anime);
    cardStack.appendChild(card);
}

function createCard(anime) {
    const el = document.createElement('div');
    el.className = 'anime-card';

    const likeBadge = document.createElement('div');
    likeBadge.className = 'nav-badge like'; likeBadge.innerText = 'LIKE ❤️';
    const skipBadge = document.createElement('div');
    skipBadge.className = 'nav-badge skip'; skipBadge.innerText = 'SKIP';
    const saveBadge = document.createElement('div');
    saveBadge.className = 'nav-badge save'; saveBadge.innerText = 'SAVE ➕';

    el.appendChild(likeBadge);
    el.appendChild(skipBadge);
    el.appendChild(saveBadge);

    const imgUrl = anime.images?.jpg?.large_image_url || '';
    const genres = anime.genres ? anime.genres.map(g => g.name).slice(0, 3).join(', ') : '';
    const scoreText = anime.score ? `⭐ ${anime.score}` : '';
    const epText = anime.episodes ? `${anime.episodes} eps` : '';
    const yearText = anime.year || '';

    let whyHtml = '';
    if (state.smartMode && anime._matchReason) {
        whyHtml = `<div class="why-tag visible"><span class="material-icons-round" style="font-size:14px">auto_awesome</span> ${anime._matchReason}</div>`;
    }

    el.innerHTML += `
        <img src="${imgUrl}" class="card-img" draggable="false" alt="${anime.title}">
        <div class="card-body">
            <h3 class="card-title">${anime.title}</h3>
            <div class="card-meta">
                <span>${anime.type || ''}</span>
                ${scoreText ? `• <span>${scoreText}</span>` : ''}
                ${epText ? `• <span>${epText}</span>` : ''}
                ${yearText ? `• <span>${yearText}</span>` : ''}
            </div>
            <div class="card-desc">${anime.synopsis || 'No description available.'}</div>
        </div>
        ${whyHtml}
    `;

    setupCardDrag(el, anime);
    setupCardClick(el, anime);
    setupLongPress(el, anime);
    return el;
}

// --- Card Click ---
function setupCardClick(card, anime) {
    card.addEventListener('click', (e) => {
        if (card._wasDragged || card._longPressed) { card._wasDragged = false; card._longPressed = false; return; }
        openModal(anime);
    });
}

// --- Card Swiping (Tinder Mode) ---
function setupCardDrag(card, anime) {
    let startX = 0, startY = 0, currentX = 0, currentY = 0, isDragging = false;
    const threshold = 90, thresholdY = 80;

    const onStart = (e) => {
        isDragging = true;
        card._wasDragged = false;
        const pt = e.type.includes('mouse') ? e : e.touches[0];
        startX = pt.clientX; startY = pt.clientY;
        card.style.transition = 'none';
        card.style.filter = 'none';
    };

    const onMove = (e) => {
        if (!isDragging) return;
        const pt = e.type.includes('mouse') ? e : e.touches[0];
        currentX = pt.clientX; currentY = pt.clientY;
        const dx = currentX - startX, dy = currentY - startY;

        // Increased threshold to 15 to prevent taps misregistering as drags
        if (Math.abs(dx) > 15 || Math.abs(dy) > 15) card._wasDragged = true;

        const rotate = dx * 0.04;
        card.style.transform = `translateX(${dx}px) translateY(${dy}px) rotate(${rotate}deg)`;

        const likeBadge = card.querySelector('.like');
        const skipBadge = card.querySelector('.skip');
        const saveBadge = card.querySelector('.save');

        if (dx > threshold) {
            likeBadge.style.opacity = Math.min((dx - threshold) / 80, 1);
            skipBadge.style.opacity = 0; saveBadge.style.opacity = 0;
            card.style.filter = 'none';
        } else if (dx < -threshold) {
            skipBadge.style.opacity = Math.min((Math.abs(dx) - threshold) / 80, 1);
            likeBadge.style.opacity = 0; saveBadge.style.opacity = 0;
            card.style.filter = 'none';
        } else if (dy > thresholdY && Math.abs(dx) < threshold) {
            saveBadge.style.opacity = Math.min((dy - thresholdY) / 80, 1);
            likeBadge.style.opacity = 0; skipBadge.style.opacity = 0;
            card.style.filter = 'none';
        } else if (dy < -thresholdY && Math.abs(dx) < threshold) {
            likeBadge.style.opacity = 0; skipBadge.style.opacity = 0; saveBadge.style.opacity = 0;
            card.style.filter = 'brightness(0.7)'; // visual indicator for open details
        } else {
            likeBadge.style.opacity = 0; skipBadge.style.opacity = 0; saveBadge.style.opacity = 0;
            card.style.filter = 'none';
        }
    };

    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        const dx = currentX - startX, dy = currentY - startY;
        card.style.transition = 'transform 0.35s ease, opacity 0.35s, filter 0.35s';

        if (dx > threshold) {
            card.style.transform = 'translateX(120vw) rotate(15deg)'; card.style.opacity = '0';
            haptic(); handleLike(anime);
            triggerHeartBurst(currentX, currentY);
            setTimeout(() => advanceCard(), 250);
        } else if (dx < -threshold) {
            card.style.transform = 'translateX(-120vw) rotate(-15deg)'; card.style.opacity = '0';
            haptic(); handleSkip(anime);
            setTimeout(() => advanceCard(), 250);
        } else if (dy > thresholdY && Math.abs(dx) < threshold) {
            card.style.transform = 'translateY(120vh)'; card.style.opacity = '0';
            haptic(); addToList(anime);
            setTimeout(() => advanceCard(), 250);
        } else if (dy < -thresholdY && Math.abs(dx) < threshold) {
            // Swipe Up -> Details
            card.style.transform = 'translateX(0) translateY(0) rotate(0)';
            card.style.filter = 'none';
            openModal(anime);
        } else {
            card.style.transform = 'translateX(0) translateY(0) rotate(0)';
            card.style.filter = 'none';
            card.querySelector('.like').style.opacity = 0;
            card.querySelector('.skip').style.opacity = 0;
            card.querySelector('.save').style.opacity = 0;
        }
    };

    card.addEventListener('touchstart', onStart, { passive: true });
    card.addEventListener('touchmove', onMove, { passive: true });
    card.addEventListener('touchend', onEnd);
    card.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
}

// --- Long Press ---
function setupLongPress(card, anime) {
    let timer;
    const start = (e) => {
        timer = setTimeout(() => {
            card._longPressed = true;
            haptic();
            showQuickActions(e, anime);
        }, 500);
    };
    const cancel = () => clearTimeout(timer);
    card.addEventListener('touchstart', start, { passive: true });
    card.addEventListener('touchend', cancel);
    card.addEventListener('touchmove', cancel);
    card.addEventListener('mousedown', start);
    card.addEventListener('mouseup', cancel);
    card.addEventListener('mouseleave', cancel);
}

function showQuickActions(e, anime) {
    const qa = quickActions;
    const pt = e.type?.includes('mouse') ? e : (e.touches?.[0] || e);
    qa.style.left = Math.min(pt.clientX, window.innerWidth - 180) + 'px';
    qa.style.top = Math.min(pt.clientY - 60, window.innerHeight - 160) + 'px';
    qa.classList.add('visible');
    $('qaLike').onclick = () => { handleLike(anime); triggerHeartBurst(pt.clientX, pt.clientY); advanceCard(); qa.classList.remove('visible'); };
    $('qaSave').onclick = () => { addToList(anime); advanceCard(); qa.classList.remove('visible'); };
    $('qaSkip').onclick = () => { handleSkip(anime); advanceCard(); qa.classList.remove('visible'); };
    setTimeout(() => document.addEventListener('click', () => qa.classList.remove('visible'), { once: true }), 100);
}

// --- Navigation ---
function advanceCard() {
    state.stats.totalSwipes++;
    state.stats.discoveries++;
    // Mark current card as seen
    const current = state.animeList[state.index];
    if (current) markSeen(current.mal_id);
    state.index++;
    checkAchievements();
    saveData();
    renderCardStack();
    updateActionBar();
    // Preload next page if approaching end
    maybePreload();
}

async function maybePreload() {
    const remaining = state.animeList.length - state.index;
    if (remaining <= PRELOAD_THRESHOLD && state.hasMorePages && !isPreloading && !isFetching) {
        isPreloading = true;
        state.currentPage++;
        try {
            await fetchAnime(true);
        } finally {
            isPreloading = false;
        }
    }
}

function updateActionBar() {
    actionBar.classList.toggle('hidden', state.animeList.length === 0);
}

$('btnSkip').addEventListener('click', () => {
    const card = document.querySelector('.anime-card');
    if (!card) return;
    card.style.transition = 'transform 0.3s, opacity 0.3s';
    card.style.transform = 'translateX(-120vw) rotate(-10deg)'; card.style.opacity = '0';
    if (state.animeList[state.index]) handleSkip(state.animeList[state.index]);
    setTimeout(advanceCard, 200);
});

$('btnLike').addEventListener('click', () => {
    const card = document.querySelector('.anime-card');
    if (!card) return;
    card.style.transition = 'transform 0.3s, opacity 0.3s';
    card.style.transform = 'translateX(120vw) rotate(10deg)'; card.style.opacity = '0';
    if (state.animeList[state.index]) {
        handleLike(state.animeList[state.index]);
        const rect = card.getBoundingClientRect();
        triggerHeartBurst(rect.left + rect.width / 2, rect.top + rect.height / 3);
    }
    setTimeout(advanceCard, 200);
});

$('btnSave').addEventListener('click', () => {
    const card = document.querySelector('.anime-card');
    if (!card) return;
    card.style.transition = 'transform 0.3s, opacity 0.3s';
    card.style.transform = 'translateY(120vh)'; card.style.opacity = '0';
    if (state.animeList[state.index]) addToList(state.animeList[state.index]);
    setTimeout(advanceCard, 200);
});

$('btnSurprise').addEventListener('click', fetchSurpriseAnime);

// --- Like / Skip Logic ---
function handleLike(anime) {
    if (!state.likedAnime.some(a => a.mal_id === anime.mal_id)) {
        state.likedAnime.push(anime);
    }
    state.stats.totalLikes++;
    updatePreferences(anime);
    checkAchievements();
    saveData();
    updateLevelDisplay();
}

function handleSkip(anime) {
    if (!state.skippedIds.includes(anime.mal_id)) state.skippedIds.push(anime.mal_id);
    state.stats.totalSkips++;
    (anime.genres || []).forEach(g => {
        state.stats.genreSkips[g.name] = (state.stats.genreSkips[g.name] || 0) + 1;
    });
    if (anime.type) {
        state.stats.typeSkips[anime.type] = (state.stats.typeSkips[anime.type] || 0) + 1;
    }
    markSeen(anime.mal_id);
    saveData();
}

// --- List Logic ---
function addToList(anime, status = 'planning') {
    if (state.watchlist.some(w => w.mal_id === anime.mal_id)) {
        showToast('Already in list', 'info'); return;
    }

    // Create a copy without the heavy description to save localStorage space
    const offlineAnime = { ...anime };
    delete offlineAnime.synopsis;

    state.watchlist.unshift({ ...offlineAnime, status, rating: 0, dateAdded: Date.now() });
    checkAchievements();
    saveData();
    showToast('Added to list!', 'bookmark_added');
    renderList();
}

function renderList() {
    const container = $('watchlistContainer');
    const filter = listFilter.value.toLowerCase();
    const statusF = state.activeStatusFilter;

    let items = state.watchlist.filter(a =>
        (a.title.toLowerCase().includes(filter) || (a.genres && a.genres.some(g => g.name.toLowerCase().includes(filter)))) &&
        (statusF === 'all' || a.status === statusF)
    );

    if (state.sortMode === 'rating') items.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else if (state.sortMode === 'score') items.sort((a, b) => (b.score || 0) - (a.score || 0));
    else if (state.sortMode === 'title') items.sort((a, b) => a.title.localeCompare(b.title));

    container.innerHTML = '';
    if (!items.length) { container.innerHTML = '<div class="empty">No anime here yet</div>'; return; }

    items.forEach(anime => {
        const el = document.createElement('div');
        el.className = 'list-item';
        const starsHtml = anime.rating ? '⭐'.repeat(anime.rating) : '<span style="color:var(--text-dim);font-size:0.72rem">Not rated</span>';
        el.innerHTML = `
            <img src="${anime.images?.jpg?.small_image_url || ''}" class="list-img" alt="${anime.title}">
            <div class="list-info">
                <div class="list-title">${anime.title}</div>
                <div class="list-subtitle">${anime.year || 'N/A'} • ${anime.type || ''} • ${anime.score ? '⭐' + anime.score : ''}</div>
                <div style="margin-top:2px">${starsHtml}</div>
                <div class="list-bottom">
                    <span class="status-badge status-${anime.status}">${anime.status}</span>
                    <div class="list-acts">
                        <button class="btn-sm" onclick="viewDetailsFromList(${anime.mal_id})" title="Details"><span class="material-icons-round">visibility</span></button>
                        <button class="btn-sm danger" onclick="removeFromList(${anime.mal_id})" title="Remove"><span class="material-icons-round">delete</span></button>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(el);
    });
}

window.removeFromList = (id) => { state.watchlist = state.watchlist.filter(a => a.mal_id !== id); saveData(); renderList(); };
window.viewDetailsFromList = (id) => { const a = state.watchlist.find(w => w.mal_id === id); if (a) openModal(a); };

// --- Modal ---
function openModal(anime) {
    currentModalAnime = anime;
    modalImg.src = anime.images?.jpg?.large_image_url || '';
    modalTitle.innerText = anime.title;
    modalDesc.innerText = anime.synopsis || 'No description.';
    modalScore.innerHTML = anime.score ? `<span class="material-icons-round" style="font-size:18px">star</span> ${anime.score} / 10 ${anime.episodes ? '• ' + anime.episodes + ' episodes' : ''} ${anime.year ? '• ' + anime.year : ''}` : '';

    modalGenres.innerHTML = '';
    (anime.genres || []).forEach(g => { const t = document.createElement('span'); t.className = 'tag'; t.innerText = g.name; modalGenres.appendChild(t); });

    const wlItem = state.watchlist.find(w => w.mal_id === anime.mal_id);
    modalListBtn.innerHTML = wlItem ? '<span class="material-icons-round">check</span> In List' : '<span class="material-icons-round">add</span> Add to Watchlist';

    // Rating
    const rating = wlItem?.rating || 0;
    document.querySelectorAll('#modalStars .star').forEach(s => s.classList.toggle('filled', parseInt(s.dataset.v) <= rating));

    // Status
    document.querySelectorAll('#modalStatusOptions .status-option').forEach(s => s.classList.toggle('active', wlItem?.status === s.dataset.status));

    modal.classList.add('open');
}

function setupModalEvents() {
    $('modalClose').addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });

    modalLikeBtn.addEventListener('click', () => {
        if (currentModalAnime) { handleLike(currentModalAnime); showToast(`Liked ${currentModalAnime.title}`, 'favorite'); }
    });
    modalListBtn.addEventListener('click', () => {
        if (currentModalAnime) { addToList(currentModalAnime); modalListBtn.innerHTML = '<span class="material-icons-round">check</span> In List'; }
    });

    // Star rating
    document.querySelectorAll('#modalStars .star').forEach(star => {
        star.addEventListener('click', () => {
            if (!currentModalAnime) return;
            const v = parseInt(star.dataset.v);
            let wlItem = state.watchlist.find(w => w.mal_id === currentModalAnime.mal_id);
            if (!wlItem) { addToList(currentModalAnime); wlItem = state.watchlist.find(w => w.mal_id === currentModalAnime.mal_id); }
            wlItem.rating = v;
            state.stats.ratingsGiven++;
            document.querySelectorAll('#modalStars .star').forEach(s => s.classList.toggle('filled', parseInt(s.dataset.v) <= v));
            checkAchievements();
            saveData();
            haptic();
        });
    });

    // Status options
    document.querySelectorAll('#modalStatusOptions .status-option').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!currentModalAnime) return;
            let wlItem = state.watchlist.find(w => w.mal_id === currentModalAnime.mal_id);
            if (!wlItem) { addToList(currentModalAnime); wlItem = state.watchlist.find(w => w.mal_id === currentModalAnime.mal_id); }
            wlItem.status = btn.dataset.status;
            document.querySelectorAll('#modalStatusOptions .status-option').forEach(s => s.classList.toggle('active', s.dataset.status === btn.dataset.status));
            checkAchievements();
            saveData();
            haptic();
        });
    });
}

// --- Achievements ---
function getAchievementProgress(ach) {
    if (ach.stat === 'manual') return ach.unlocked ? 1 : 0;
    if (ach.stat === 'totalLikes') return state.stats.totalLikes;
    if (ach.stat === 'totalSwipes') return state.stats.totalSwipes;
    if (ach.stat === 'ratingsGiven') return state.stats.ratingsGiven;
    if (ach.stat === 'watchlistCount') return state.watchlist.length;
    if (ach.stat === 'genreVariety') return Object.keys(state.stats.genreLikes).length;
    if (ach.stat === 'completedCount') return state.watchlist.filter(w => w.status === 'completed').length;
    if (ach.stat === 'streakBest') return state.streak.bestStreak;
    if (ach.stat.startsWith('genre_')) {
        const genre = ach.stat.split('_')[1];
        return state.stats.genreLikes[genre] || 0;
    }
    return 0;
}

function checkAchievements() {
    state.achievements.forEach(ach => {
        if (ach.unlocked) return;
        const progress = getAchievementProgress(ach);
        if (progress >= ach.goal) {
            ach.unlocked = true;
            showAchievementToast(ach);
            renderAchievements();
        }
    });
}

function unlockManual(id) {
    const ach = state.achievements.find(a => a.id === id);
    if (ach && !ach.unlocked) { ach.unlocked = true; showAchievementToast(ach); renderAchievements(); saveData(); }
}

function showAchievementToast(ach) {
    const t = $('achToast');
    $('achToastTitle').innerText = `🏆 ${ach.title}`;
    t.classList.add('show');
    haptic();
    setTimeout(() => t.classList.remove('show'), 3000);
}

function renderAchievements() {
    const grid = $('achGrid');
    grid.innerHTML = '';
    state.achievements.forEach(a => {
        const progress = getAchievementProgress(a);
        const pct = Math.min(100, (progress / a.goal) * 100);
        const el = document.createElement('div');
        el.className = `ach-card ${a.unlocked ? 'unlocked' : ''}`;
        el.innerHTML = `
            <div class="ach-icon material-icons-round">${a.icon}</div>
            <div class="ach-title">${a.title}</div>
            <div class="ach-desc">${a.desc}</div>
            <div class="ach-progress"><div class="ach-progress-fill" style="width:${pct}%"></div></div>
        `;
        grid.appendChild(el);
    });
}

// --- Level & XP ---
function getXpInfo() {
    const xp = (state.stats.totalLikes * 10) + (state.watchlist.length * 15) + (state.stats.ratingsGiven * 5) + (state.streak.current * 3) + (state.stats.totalSwipes * 1);
    const lvl = Math.floor(xp / 100) + 1;
    const xpInLevel = xp % 100;
    return { xp, lvl, xpInLevel, xpNeeded: 100 };
}

function updateLevelDisplay() {
    const { lvl, xpInLevel, xpNeeded } = getXpInfo();
    $('levelDisplay').innerText = `Lvl ${lvl}`;
    $('xpBarFill').style.width = `${(xpInLevel / xpNeeded) * 100}%`;
}

// --- Profile / Stats ---
function renderProfile() {
    const { lvl, xp, xpInLevel, xpNeeded } = getXpInfo();
    $('profileLevel').innerText = `Level ${lvl}`;
    $('profileXpText').innerText = `${xpInLevel} / ${xpNeeded} XP`;
    $('profileXpFill').style.width = `${(xpInLevel / xpNeeded) * 100}%`;

    $('streakNum').innerText = state.streak.current;
    $('bestStreak').innerText = state.streak.bestStreak;

    $('statLikes').innerText = state.stats.totalLikes;
    $('statSwipes').innerText = state.stats.totalSwipes;
    $('statWatchlist').innerText = state.watchlist.length;

    const likedScores = state.likedAnime.map(a => a.score).filter(Boolean);
    $('statAvgScore').innerText = likedScores.length ? (likedScores.reduce((s, v) => s + v, 0) / likedScores.length).toFixed(1) : '—';

    drawGenreChart();
    renderTopAnime();
}

function drawGenreChart() {
    const canvas = $('genreChart');
    const ctx = canvas.getContext('2d');
    const data = state.stats.genreLikes;
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (!entries.length) { ctx.clearRect(0, 0, 140, 140); $('chartLegend').innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem">Like some anime to see your taste map!</div>'; return; }

    const total = entries.reduce((s, [, v]) => s + v, 0);
    const colors = ['#6200ea', '#03dac6', '#ff4b8a', '#4fc3f7', '#ffd54f', '#81c784'];
    const cx = 70, cy = 70, r = 60;
    let start = -Math.PI / 2;
    ctx.clearRect(0, 0, 140, 140);

    entries.forEach(([name, val], i) => {
        const angle = (val / total) * 2 * Math.PI;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, start, start + angle);
        ctx.fillStyle = colors[i % colors.length]; ctx.fill();
        start += angle;
    });

    // Center hole (donut)
    ctx.beginPath(); ctx.arc(cx, cy, 32, 0, 2 * Math.PI);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(); ctx.fill();

    const legend = $('chartLegend');
    legend.innerHTML = entries.map(([name, val], i) =>
        `<div class="legend-item"><div class="legend-dot" style="background:${colors[i]}"></div>${name} <span style="color:var(--text-dim);margin-left:auto">${val}</span></div>`
    ).join('');
}

function renderTopAnime() {
    const rated = state.watchlist.filter(w => w.rating > 0).sort((a, b) => b.rating - a.rating).slice(0, 5);
    const container = $('topAnimeList');
    if (!rated.length) { container.innerHTML = '<div style="color:var(--text-dim);font-size:0.85rem;padding:10px">Rate some anime to see your top picks!</div>'; return; }
    container.innerHTML = rated.map((a, i) => `
        <div class="top-anime-item">
            <div class="top-rank">#${i + 1}</div>
            <img class="top-img" src="${a.images?.jpg?.small_image_url || ''}" alt="">
            <div class="top-info">
                <div class="top-title">${a.title}</div>
                <div class="top-sub">${'⭐'.repeat(a.rating)} • ${a.type || ''}</div>
            </div>
        </div>
    `).join('');
}

// --- Social Export (Redesigned Taste Card) ---
$('btnExport').addEventListener('click', () => {
    const canvas = $('exportCanvas');
    canvas.width = 600; canvas.height = 900;
    const ctx = canvas.getContext('2d');
    const { lvl } = getXpInfo();
    const W = 600, H = 900;

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1a1a2e'); bg.addColorStop(0.5, '#16132b'); bg.addColorStop(1, '#0e0e12');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Decorative circles
    ctx.globalAlpha = 0.06;
    ctx.beginPath(); ctx.arc(50, 100, 200, 0, Math.PI * 2); ctx.fillStyle = '#6200ea'; ctx.fill();
    ctx.beginPath(); ctx.arc(550, 750, 250, 0, Math.PI * 2); ctx.fillStyle = '#03dac6'; ctx.fill();
    ctx.globalAlpha = 1;

    // Header bar
    const hg = ctx.createLinearGradient(0, 0, W, 80);
    hg.addColorStop(0, '#6200ea'); hg.addColorStop(1, '#9d46ff');
    ctx.fillStyle = hg;
    roundRect(ctx, 20, 20, W - 40, 80, 20); ctx.fill();

    ctx.fillStyle = 'white'; ctx.font = 'bold 28px Inter, sans-serif';
    ctx.textAlign = 'left'; ctx.fillText('AniMatch', 40, 68);
    ctx.font = '16px Inter, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(`Level ${lvl}`, W - 40, 55);
    ctx.font = '12px Inter, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`${state.stats.totalLikes} Likes • ${state.streak.bestStreak}🔥 Streak`, W - 40, 75);

    // Stats row
    const stats = [
        { label: 'Likes', value: state.stats.totalLikes, color: '#ff4b8a' },
        { label: 'Swipes', value: state.stats.totalSwipes, color: '#4fc3f7' },
        { label: 'In List', value: state.watchlist.length, color: '#81c784' },
        { label: 'Streak', value: state.streak.bestStreak, color: '#ffd54f' }
    ];
    stats.forEach((s, i) => {
        const x = 20 + i * ((W - 40) / 4);
        const w = (W - 60) / 4;
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        roundRect(ctx, x + (i > 0 ? 5 : 0), 120, w, 70, 12); ctx.fill();
        ctx.fillStyle = s.color; ctx.font = 'bold 24px Inter, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(s.value, x + w / 2 + (i > 0 ? 2.5 : 0), 155);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '11px Inter, sans-serif';
        ctx.fillText(s.label, x + w / 2 + (i > 0 ? 2.5 : 0), 175);
    });

    // Genre section
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, 20, 210, W - 40, 180, 16); ctx.fill();
    ctx.fillStyle = 'white'; ctx.font = 'bold 16px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('🎨 Genre Taste', 40, 240);
    const topGenres = Object.entries(state.stats.genreLikes).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const genreColors = ['#6200ea', '#03dac6', '#ff4b8a', '#4fc3f7', '#ffd54f'];
    const maxGenre = topGenres.length ? topGenres[0][1] : 1;
    topGenres.forEach(([name, val], i) => {
        const y = 260 + i * 24;
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '13px Inter, sans-serif';
        ctx.textAlign = 'left'; ctx.fillText(name, 40, y + 4);
        // Bar
        const barX = 180, barW = 320, barH = 12;
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        roundRect(ctx, barX, y - 8, barW, barH, 6); ctx.fill();
        ctx.fillStyle = genreColors[i];
        roundRect(ctx, barX, y - 8, barW * (val / maxGenre), barH, 6); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'right'; ctx.fillText(val, W - 30, y + 4);
    });
    if (!topGenres.length) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '13px Inter, sans-serif';
        ctx.textAlign = 'center'; ctx.fillText('No data yet — start swiping!', W / 2, 300);
    }

    // Top Rated section
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, 20, 410, W - 40, 220, 16); ctx.fill();
    ctx.fillStyle = 'white'; ctx.font = 'bold 16px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('⭐ Top Rated by You', 40, 440);
    const topRated = state.watchlist.filter(w => w.rating > 0).sort((a, b) => b.rating - a.rating).slice(0, 5);
    topRated.forEach((a, i) => {
        const y = 465 + i * 32;
        ctx.fillStyle = '#ffd54f'; ctx.font = '14px Inter, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(`#${i + 1}`, 40, y);
        ctx.fillText('★'.repeat(a.rating), 70, y);
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '13px Inter, sans-serif';
        ctx.fillText(a.title.length > 35 ? a.title.slice(0, 35) + '…' : a.title, 160, y);
    });
    if (!topRated.length) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '13px Inter, sans-serif';
        ctx.textAlign = 'center'; ctx.fillText('Rate anime to see your top picks here!', W / 2, 500);
    }

    // Achievements section
    const unlocked = state.achievements.filter(a => a.unlocked);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, 20, 650, W - 40, 100, 16); ctx.fill();
    ctx.fillStyle = 'white'; ctx.font = 'bold 16px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`🏆 ${unlocked.length}/${state.achievements.length} Achievements`, 40, 680);
    ctx.fillStyle = '#03dac6'; ctx.font = '12px Inter, sans-serif';
    const achText = unlocked.map(a => a.title).join('  •  ') || 'None unlocked yet';
    ctx.fillText(achText.length > 70 ? achText.slice(0, 70) + '…' : achText, 40, 705);
    // Progress bar
    const achPct = unlocked.length / state.achievements.length;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    roundRect(ctx, 40, 720, W - 80, 8, 4); ctx.fill();
    ctx.fillStyle = '#03dac6';
    roundRect(ctx, 40, 720, (W - 80) * achPct, 8, 4); ctx.fill();

    // Footer
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('Generated by AniMatch V3 • animatch.app', W / 2, H - 30);

    // Border glow
    ctx.strokeStyle = 'rgba(98, 0, 234, 0.3)'; ctx.lineWidth = 2;
    roundRect(ctx, 10, 10, W - 20, H - 20, 24); ctx.stroke();

    canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = 'animatch-taste-card.png';
        link.click();
        showToast('Taste card downloaded!', 'download');
    });
});

// Canvas rounded rectangle helper
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

// --- Theme ---
function setupThemeToggle() {
    document.documentElement.setAttribute('data-theme', state.theme);
    updateThemeIcon();
    $('btnTheme').addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', state.theme);
        updateThemeIcon();
        saveData();
    });
}
function updateThemeIcon() {
    $('btnTheme').querySelector('.material-icons-round').innerText = state.theme === 'dark' ? 'light_mode' : 'dark_mode';
}

// --- Smart Match Toggle ---
$('btnSmartMatch').addEventListener('click', () => {
    state.smartMode = !state.smartMode;
    $('btnSmartMatch').classList.toggle('active-mode', state.smartMode);
    if (state.smartMode) {
        if (Object.keys(state.preferences.genre).length === 0) {
            showToast('Like some anime first to build your taste!', 'info');
            state.smartMode = false;
            $('btnSmartMatch').classList.remove('active-mode');
            return;
        }
        showToast('🎯 Smart Match activated!', 'auto_awesome');
    } else {
        showToast('Smart Match off', 'explore');
    }
    state.currentPage = 1; state.hasMorePages = true;
    fetchAnime();
});

// --- List Filters & Sort ---
listFilter.addEventListener('input', renderList);

document.querySelectorAll('#statusFilters .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        document.querySelectorAll('#statusFilters .filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.activeStatusFilter = chip.dataset.status;
        renderList();
    });
});

$('btnSort').addEventListener('click', () => {
    const modes = ['recent', 'rating', 'score', 'title'];
    const labels = ['Recent', 'Your Rating', 'Score', 'A–Z'];
    const idx = (modes.indexOf(state.sortMode) + 1) % modes.length;
    state.sortMode = modes[idx];
    $('btnSort').innerHTML = `<span class="material-icons-round" style="font-size:14px">sort</span> ${labels[idx]}`;
    renderList();
});

// --- Utilities ---
function showToast(msg, iconName = 'info') {
    const t = $('toast');
    t.innerHTML = `<span class="material-icons-round" style="font-size:16px">${iconName}</span> ${msg}`;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

function haptic() { try { navigator.vibrate?.(12); } catch (e) { } }

function triggerHeartBurst(x, y) {
    const container = document.createElement('div');
    container.className = 'heart-burst';
    container.style.left = x + 'px'; container.style.top = y + 'px';
    for (let i = 0; i < 8; i++) {
        const p = document.createElement('div');
        p.className = 'heart-particle';
        p.innerText = '❤️';
        const angle = (i / 8) * Math.PI * 2;
        const dist = 40 + Math.random() * 40;
        p.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
        p.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
        p.style.animationDelay = (Math.random() * 0.15) + 's';
        container.appendChild(p);
    }
    document.body.appendChild(container);
    setTimeout(() => container.remove(), 1000);
}

// --- Persistence ---
function saveData() {
    const data = {
        watchlist: state.watchlist,
        likedAnime: state.likedAnime,
        skippedIds: state.skippedIds.slice(-200),
        stats: state.stats,
        preferences: state.preferences,
        streak: state.streak,
        achievements: state.achievements.map(a => ({ id: a.id, unlocked: a.unlocked })),
        theme: state.theme,
        privacyAccepted: state.privacyAccepted
    };
    localStorage.setItem('animatch_v3', JSON.stringify(data));
}

function loadData() {
    const raw = localStorage.getItem('animatch_v3');
    if (!raw) {
        // Migrate from V2
        const v2 = localStorage.getItem('animatch_v2');
        if (v2) {
            try {
                const d = JSON.parse(v2);
                state.watchlist = (d.watchlist || []).map(a => ({ ...a, status: 'planning', rating: 0, dateAdded: Date.now() }));
                state.stats.totalLikes = d.liked || 0;
                showToast('Data migrated from V2!', 'upgrade');
            } catch (e) { }
        }
        return;
    }
    try {
        const d = JSON.parse(raw);
        state.watchlist = d.watchlist || [];
        state.likedAnime = d.likedAnime || [];
        state.skippedIds = d.skippedIds || [];
        state.stats = { ...state.stats, ...d.stats };
        state.preferences = { ...state.preferences, ...d.preferences };
        state.streak = { ...state.streak, ...d.streak };
        state.theme = d.theme || 'dark';
        state.privacyAccepted = d.privacyAccepted || false;
        if (d.achievements) {
            d.achievements.forEach(da => {
                const a = state.achievements.find(x => x.id === da.id);
                if (a) a.unlocked = da.unlocked;
            });
        }
    } catch (e) { console.error('Load error', e); }
}

// --- Navigation ---
function setupNav() {
    const items = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');
    items.forEach(item => {
        item.addEventListener('click', () => {
            switchToView(item.dataset.target);
        });
    });
}

function switchToView(target) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.target === target));
    document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); if (v.id === target) v.classList.add('active'); });
    if (target === 'view-list') renderList();
    if (target === 'view-profile') renderProfile();
    if (target === 'view-achievements') renderAchievements();
}

function setupInputs() {
    searchInput.addEventListener('input', () => { state.smartMode = false; $('btnSmartMatch').classList.remove('active-mode'); debounceFetch(); });
    genreSelect.addEventListener('change', () => { state.smartMode = false; $('btnSmartMatch').classList.remove('active-mode'); debounceFetch(); });
}

function setupQuickActions() { } // Setup handled inline

// --- PWA ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
}

// --- Start ---
init();
