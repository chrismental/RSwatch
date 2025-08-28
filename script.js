document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const homePage = document.getElementById('home-page');
    const videoPage = document.getElementById('video-page');
    const heartsContainer = document.getElementById('hearts-container');

    // Buttons
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');
    const loadVideoBtn = document.getElementById('load-video-btn');
    const sendChatBtn = document.getElementById('send-chat-btn');
    const sendHugBtn = document.getElementById('send-hug-btn');

    // Inputs
    const joinRoomInput = document.getElementById('join-room-input');
    const youtubeUrlInput = document.getElementById('youtube-url-input');
    const chatInput = document.getElementById('chat-input');

    // Modals
    const createRoomModal = document.getElementById('create-room-modal');
    const joinPasswordModal = document.getElementById('join-password-modal');
    const signalingModal = document.getElementById('signaling-modal');
    const errorModal = document.getElementById('error-modal');
    const signalingContent = document.getElementById('signaling-content');
    const roomPasswordInput = document.getElementById('room-password-input');
    const confirmCreateRoomBtn = document.getElementById('confirm-create-room-btn');
    const joinPasswordInput = document.getElementById('join-password-input');
    const confirmJoinBtn = document.getElementById('confirm-join-btn');
    const errorMessage = document.getElementById('error-message');
    const closeErrorModalBtn = document.getElementById('close-error-modal-btn');
    const themeSelectionContainer = document.getElementById('theme-selection');

    // Video & Chat
    const playerContainer = document.getElementById('player');
    const chatBox = document.getElementById('chat-box');
    const playlistBox = document.getElementById('playlist-box');
    const hugAnimationContainer = document.getElementById('hug-animation-container');

    // --- State --- 
    let player;
    let peerConnection;
    let dataChannel;
    let isPeerConnected = false;
    let isHost = false;
    let roomData = {};
    let selectedTheme = 'default';
    let playlist = [];

    const peerConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    // --- Floating Hearts --- //
    function createHeart() {
        const heart = document.createElement('div');
        heart.classList.add('heart');
        heart.style.left = `${Math.random() * 100}vw`;
        heart.style.animationDuration = `${Math.random() * 5 + 5}s`;
        heartsContainer.appendChild(heart);
        setTimeout(() => heart.remove(), 10000);
    }
    setInterval(createHeart, 500);

    // --- Modal Controls --- //
    function showModal(modal) { modal.classList.remove('hidden'); }
    function hideModal(modal) { modal.classList.add('hidden'); }

    createRoomBtn.addEventListener('click', () => showModal(createRoomModal));
    document.querySelectorAll('.close-modal-btn').forEach(btn => 
        btn.addEventListener('click', () => btn.closest('.modal').classList.add('hidden'))
    );
    closeErrorModalBtn.addEventListener('click', () => hideModal(errorModal));

    themeSelectionContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('theme-btn')) {
            selectedTheme = e.target.dataset.theme;
            document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.remove('selected'));
            e.target.classList.add('selected');
        }
    });

    playlistBox.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-btn')) {
            const videoId = e.target.dataset.id;
            removeVideoFromPlaylistAndSync(videoId);
        }
    });

    // --- Error Handling --- //
    function showError(message) {
        errorMessage.textContent = message;
        showModal(errorModal);
    }

    // --- YouTube Player --- //
    window.onYouTubeIframeAPIReady = () => {};

    function createYouTubePlayer(videoId) {
        if (player) player.destroy();
        document.getElementById('video-placeholder').style.display = 'none';
        playerContainer.style.display = 'block';
        player = new YT.Player('player', {
            height: '100%', width: '100%', videoId: videoId,
            playerVars: { 'autoplay': 1, 'controls': 1, 'rel': 0, 'showinfo': 0 },
            events: { 'onStateChange': onPlayerStateChange }
        });
    }

    function onPlayerStateChange(event) {
        if (!isPeerConnected || !dataChannel || dataChannel.readyState !== 'open') return;
        // Sync basic player controls
        dataChannel.send(JSON.stringify({ type: 'video_state', state: event.data, time: player.getCurrentTime() }));

        // Handle playing next video in queue
        if (event.data === YT.PlayerState.ENDED && isHost) {
            if (playlist.length > 1) { // Only send if there is a next video
                dataChannel.send(JSON.stringify({ type: 'play_next' }));
                playNextInQueue(); // Host plays next immediately
            }
        }
    }

    function getYouTubeVideoId(url) {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    loadVideoBtn.addEventListener('click', () => {
        const videoUrl = youtubeUrlInput.value;
        const videoId = getYouTubeVideoId(videoUrl);
        if (videoId) {
            const video = { id: videoId, title: videoUrl }; // Using URL as title for simplicity
            addVideoToPlaylistAndSync(video);
            youtubeUrlInput.value = '';
        }
    });

    function addVideoToPlaylistAndSync(video) {
        playlist.push(video);
        renderPlaylist();
        if (isPeerConnected) {
            dataChannel.send(JSON.stringify({ type: 'playlist_add', video: video }));
        }
        // If this is the first video, start playing it.
        if (!player || player.getPlayerState() <= 0) {
            playNextInQueue();
        }
    }

    function playNextInQueue() {
        playlist.shift(); // Remove the video that just finished
        renderPlaylist();
        if (playlist.length > 0) {
            createYouTubePlayer(playlist[0].id);
        } else {
            // No more videos, show placeholder
            if(player) player.destroy();
            document.getElementById('video-placeholder').style.display = 'grid';
        }
    }

    // --- WebRTC Signaling & Connection --- //
    function initializePeerConnection() {
        peerConnection = new RTCPeerConnection(peerConfig);
        peerConnection.onicecandidate = e => {
            // ICE candidates are handled automatically by the browser
        };
        peerConnection.ondatachannel = e => {
            dataChannel = e.channel;
            setupDataChannel();
        };
    }

    function setupDataChannel() {
        dataChannel.onopen = () => {
            isPeerConnected = true;
            hideModal(signalingModal);
            if (isHost && player && player.getPlayerState() > 0) {
                const syncData = {
                    type: 'initial_sync',
                    videoId: player.getVideoData().video_id,
                    time: player.getCurrentTime()
                };
                dataChannel.send(JSON.stringify(syncData));
            }
        };
        dataChannel.onmessage = e => handleMessage(JSON.parse(e.data));
    }

    function handleMessage(msg) {
        switch (msg.type) {
            case 'initial_sync':
                createYouTubePlayer(msg.videoId);
                // We need to wait for the player to be ready before seeking
                setTimeout(() => {
                    if (player) {
                        player.seekTo(msg.time, true);
                        player.playVideo(); // Or sync to the host's state
                    }
                }, 1000); // A short delay to allow the player to initialize
                break;
            case 'load_video': createYouTubePlayer(msg.videoId); break;
            case 'playlist_add':
                playlist.push(msg.video);
                renderPlaylist();
                break;
            case 'play_next':
                playNextInQueue(true);
                break;
            case 'playlist_remove':
                playlist = playlist.filter(video => video.id !== msg.videoId);
                renderPlaylist();
                break;
            case 'video_state':
                if (player && Math.abs(player.getCurrentTime() - msg.time) > 2) {
                    player.seekTo(msg.time, true);
                }
                if (msg.state === YT.PlayerState.PLAYING) player.playVideo();
                else if (msg.state === YT.PlayerState.PAUSED) player.pauseVideo();
                break;
            case 'chat': displayChatMessage(msg.text, 'received'); break;
            case 'hug': showHugAnimation(); break;
        }
    }

    function applyTheme(theme) {
        document.body.className = `theme-${theme}`;
    }

    // --- Playlist Logic ---
    function renderPlaylist() {
        playlistBox.innerHTML = '';
        if (playlist.length === 0) {
            playlistBox.innerHTML = '<p>Add videos to the queue!</p>';
            return;
        }
        playlist.forEach((video, index) => {
            const item = document.createElement('div');
            item.classList.add('playlist-item');
            item.innerHTML = `<p>${index + 1}. ${video.title}</p><button class="remove-btn" data-id="${video.id}">✖</button>`;
            playlistBox.appendChild(item);
        });
    }

    function removeVideoFromPlaylistAndSync(videoId) {
        playlist = playlist.filter(video => video.id !== videoId);
        renderPlaylist();
        if (isPeerConnected) {
            dataChannel.send(JSON.stringify({ type: 'playlist_remove', videoId: videoId }));
        }
    }

    // --- Room Creation (User 1) ---
    confirmCreateRoomBtn.addEventListener('click', async () => {
        const password = roomPasswordInput.value;
        if (!password) { showError('Please set a password.'); return; }

        isHost = true;

        hideModal(createRoomModal);
        initializePeerConnection();
        dataChannel = peerConnection.createDataChannel('data');
        setupDataChannel();

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        const roomInfo = {
            offer: offer,
            pw: btoa(password), // Simple encoding, not encryption
            theme: selectedTheme
        };
        const roomLink = `${window.location.href.split('#')[0]}#${btoa(JSON.stringify(roomInfo))}`;

        applyTheme(selectedTheme);
        homePage.classList.add('hidden');
        videoPage.classList.remove('hidden');

        displaySignalingInfoForCreator(roomLink);
    });

    function displaySignalingInfoForCreator(roomLink) {
        signalingContent.innerHTML = `
            <h2>Room Created!</h2>
            <p>1. Share this link with your partner:</p>
            <textarea readonly>${roomLink}</textarea>
            <p>2. When they send you an answer code, paste it here:</p>
            <textarea id="answer-input" placeholder="Paste answer code here"></textarea>
            <button id="connect-btn" class="btn btn-primary">Connect</button>
        `;
        showModal(signalingModal);

        document.getElementById('connect-btn').addEventListener('click', async () => {
            const answer = JSON.parse(atob(document.getElementById('answer-input').value));
            if (answer) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            }
        });
    }

    // --- Room Joining (User 2) ---
    joinRoomBtn.addEventListener('click', () => {
        const link = joinRoomInput.value;
        if (!link || !link.includes('#')) {
            showError('Please enter a valid room link.');
            return;
        }
        try {
            roomData = JSON.parse(atob(link.split('#')[1]));
            if (!roomData.offer || !roomData.pw) throw new Error('Invalid link');
            showModal(joinPasswordModal);
        } catch (e) {
            showError('The room link is invalid or corrupted.');
        }
    });

    confirmJoinBtn.addEventListener('click', async () => {
        const password = joinPasswordInput.value;
        if (btoa(password) !== roomData.pw) {
            showError('Incorrect password!');
            return;
        }

        applyTheme(roomData.theme);
        hideModal(joinPasswordModal);
        initializePeerConnection();

        await peerConnection.setRemoteDescription(new RTCSessionDescription(roomData.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        homePage.classList.add('hidden');
        videoPage.classList.remove('hidden');
        displaySignalingInfoForJoiner(btoa(JSON.stringify(answer)));
    });

    function displaySignalingInfoForJoiner(answerCode) {
        signalingContent.innerHTML = `
            <h2>Almost there!</h2>
            <p>Send this answer code back to your partner to connect:</p>
            <textarea readonly>${answerCode}</textarea>
            <p>Once they connect, this window will close automatically.</p>
        `;
        showModal(signalingModal);
    }

    // --- Chat Logic --- //
    function displayChatMessage(text, type) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('chat-message', type);
        const avatar = type === 'sent' ? '🥰' : '❤️';
        const body = document.createElement('span');
        body.classList.add('message-body');
        body.textContent = text;
        msgDiv.innerHTML = `<span class="avatar">${avatar}</span>`;
        msgDiv.appendChild(body);
        chatBox.appendChild(msgDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function sendChatMessage() {
        const text = chatInput.value;
        if (text.trim() === '') return;
        displayChatMessage(text, 'sent');
        if (isPeerConnected) {
            dataChannel.send(JSON.stringify({ type: 'chat', text: text }));
        }
        chatInput.value = '';
    }

    sendChatBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', e => e.key === 'Enter' && sendChatMessage());

    // --- Hug Animation Logic ---
    function showHugAnimation() {
        hugAnimationContainer.innerHTML = '🤗';
        hugAnimationContainer.classList.add('show-hug');
        setTimeout(() => {
            hugAnimationContainer.classList.remove('show-hug');
        }, 1500);
    }

    sendHugBtn.addEventListener('click', () => {
        showHugAnimation();
        if (isPeerConnected) {
            dataChannel.send(JSON.stringify({ type: 'hug' }));
        }
    });
});