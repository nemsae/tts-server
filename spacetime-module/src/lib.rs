use spacetimedb::rand::Rng;
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

const ROOM_CODE_CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_ROOM_CODE_GENERATION_ATTEMPTS: u32 = 10;

fn generate_room_code(ctx: &ReducerContext) -> Option<String> {
    let mut rng = ctx.rng();
    let len = ROOM_CODE_CHARS.len() as i32;
    for _ in 0..MAX_ROOM_CODE_GENERATION_ATTEMPTS {
        let code: String = (0..4)
            .map(|_| {
                let idx = rng.gen_range(0..len) as usize;
                ROOM_CODE_CHARS[idx] as char
            })
            .collect();
        if ctx.db.room().room_code().find(&code).is_none() {
            return Some(code);
        }
    }
    None
}

fn player_count_in_room(ctx: &ReducerContext, room_code: &str) -> u64 {
    ctx.db.player().by_room().filter(room_code).count() as u64
}

#[spacetimedb::table(name = room, public)]
#[derive(Clone, Debug)]
pub struct Room {
    #[primary_key]
    pub room_code: String,
    pub host_identity: Identity,
    pub topic: String,
    pub rounds: u32,
    pub round_time_limit: u32,
    pub status: String,
    pub created_at: Timestamp,
}

#[spacetimedb::table(
    name = player,
    public,
    index(name = by_room, btree(columns = [room_code]))
)]
#[derive(Clone, Debug)]
pub struct Player {
    #[primary_key]
    pub identity: Identity,
    pub room_code: String,
    #[unique]
    pub name: String,
    pub is_host: bool,
    pub is_online: bool,
    pub current_score: u32,
    pub joined_at: Timestamp,
}

#[spacetimedb::table(
    name = peer_signal,
    public,
    index(name = by_from, btree(columns = [from_identity])),
    index(name = by_to, btree(columns = [to_identity])),
    index(name = by_room, btree(columns = [room_code]))
)]
#[derive(Clone, Debug)]
pub struct PeerSignal {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub from_identity: Identity,
    pub to_identity: Identity,
    pub room_code: String,
    pub signal_type: String,
    pub signal_data: String,
    pub created_at: Timestamp,
}

#[spacetimedb::table(
    name = mute_state,
    public,
    index(name = by_muter_muted, btree(columns = [muter_identity, muted_identity]))
)]
#[derive(Clone, Debug)]
pub struct MuteState {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub muter_identity: Identity,
    pub muted_identity: Identity,
    pub is_muted: bool,
}

#[spacetimedb::reducer(init)]
pub fn init(_ctx: &ReducerContext) {}

#[spacetimedb::reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) {
    log::info!("Client connected: {}", ctx.sender);
    if let Some(mut player) = ctx.db.player().identity().find(&ctx.sender) {
        player.is_online = true;
        ctx.db.player().identity().update(player);
    }
}

#[spacetimedb::reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    log::info!("Client disconnected: {}", ctx.sender);
    if let Some(mut player) = ctx.db.player().identity().find(&ctx.sender) {
        player.is_online = false;
        ctx.db.player().identity().update(player);
    }
}

#[spacetimedb::reducer]
pub fn create_room(
    ctx: &ReducerContext,
    name: String,
    topic: String,
    rounds: u32,
    round_time_limit: u32,
) -> Result<(), String> {
    let caller = ctx.sender;

    if ctx.db.player().identity().find(&caller).is_some() {
        return Err("Already in a room".to_string());
    }

    if name.len() > 20 {
        return Err("Name must be 20 characters or less".to_string());
    }

    if rounds < 1 || rounds > 10 {
        return Err("Rounds must be between 1 and 10".to_string());
    }

    if round_time_limit < 5 || round_time_limit > 120 {
        return Err("Round time limit must be between 5 and 120 seconds".to_string());
    }

    let room_code = generate_room_code(ctx).ok_or("Failed to generate unique room code")?;

    let room = Room {
        room_code: room_code.clone(),
        host_identity: caller,
        topic,
        rounds,
        round_time_limit,
        status: "lobby".to_string(),
        created_at: ctx.timestamp,
    };
    ctx.db.room().insert(room);

    let player = Player {
        identity: caller,
        room_code: room_code.clone(),
        name,
        is_host: true,
        is_online: true,
        current_score: 0,
        joined_at: ctx.timestamp,
    };
    ctx.db.player().insert(player);

    log::info!("Room created: {} by {}", room_code, caller);
    Ok(())
}

#[spacetimedb::reducer]
pub fn join_room(ctx: &ReducerContext, room_code: String, name: String) -> Result<(), String> {
    let caller = ctx.sender;

    if ctx.db.player().identity().find(&caller).is_some() {
        return Err("Already in a room".to_string());
    }

    if name.len() > 20 {
        return Err("Name must be 20 characters or less".to_string());
    }

    let room = ctx
        .db
        .room()
        .room_code()
        .find(&room_code)
        .ok_or("Room not found".to_string())?;

    if room.status != "lobby" {
        return Err("Room is not in lobby status".to_string());
    }

    if player_count_in_room(ctx, &room_code) >= 4 {
        return Err("Room is full (max 4 players)".to_string());
    }

    let player = Player {
        identity: caller,
        room_code: room_code.clone(),
        name,
        is_host: false,
        is_online: true,
        current_score: 0,
        joined_at: ctx.timestamp,
    };
    ctx.db.player().insert(player);

    log::info!("Player {} joined room {}", caller, room_code);
    Ok(())
}

#[spacetimedb::reducer]
pub fn leave_room(ctx: &ReducerContext) -> Result<(), String> {
    let caller = ctx.sender;

    let player = ctx
        .db
        .player()
        .identity()
        .find(&caller)
        .ok_or("Not in a room".to_string())?;

    let room_code = player.room_code.clone();
    let was_host = player.is_host;

    ctx.db.player().identity().delete(&caller);

    for signal in ctx.db.peer_signal().by_from().filter(&caller) {
        ctx.db.peer_signal().id().delete(&signal.id);
    }
    for signal in ctx.db.peer_signal().by_to().filter(&caller) {
        ctx.db.peer_signal().id().delete(&signal.id);
    }
    for signal in ctx.db.peer_signal().by_room().filter(&room_code) {
        ctx.db.peer_signal().id().delete(&signal.id);
    }

    let remaining_players: Vec<Player> = ctx.db.player().by_room().filter(&room_code).collect();

    if remaining_players.is_empty() {
        ctx.db.room().room_code().delete(&room_code);
        log::info!("Room {} deleted (empty)", room_code);
    } else if was_host {
        let mut sorted_players = remaining_players;
        sorted_players.sort_by(|a, b| a.joined_at.cmp(&b.joined_at));
        if let Some(new_host) = sorted_players.first() {
            let mut updated_host = new_host.clone();
            updated_host.is_host = true;
            ctx.db.player().identity().update(updated_host);

            if let Some(room) = ctx.db.room().room_code().find(&room_code) {
                let mut updated_room = room.clone();
                updated_room.host_identity = new_host.identity;
                ctx.db.room().room_code().update(updated_room);
            }

            log::info!("Host promoted in room {}: {}", room_code, new_host.identity);
        }
    }

    log::info!("Player {} left room {}", caller, room_code);
    Ok(())
}

const MAX_SIGNAL_DATA_SIZE: usize = 8192;
const VALID_SIGNAL_TYPES: &[&str] = &["offer", "answer", "ice-candidate"];

fn validate_signal_type(signal_type: &str) -> Result<String, String> {
    if VALID_SIGNAL_TYPES.contains(&signal_type) {
        Ok(signal_type.to_string())
    } else {
        Err(format!(
            "Invalid signal_type. Must be one of: {}",
            VALID_SIGNAL_TYPES.join(", ")
        ))
    }
}

fn validate_signal_data(data: &str) -> Result<String, String> {
    if data.is_empty() {
        return Err("signal_data must not be empty".to_string());
    }
    if data.len() > MAX_SIGNAL_DATA_SIZE {
        return Err(format!(
            "signal_data exceeds maximum size of {} bytes",
            MAX_SIGNAL_DATA_SIZE
        ));
    }
    Ok(data.to_string())
}

#[spacetimedb::reducer]
pub fn send_signal(
    ctx: &ReducerContext,
    to_identity: Identity,
    signal_type: String,
    signal_data: String,
) -> Result<(), String> {
    let caller = ctx.sender;

    let signal_type = validate_signal_type(&signal_type)?;
    let signal_data = validate_signal_data(&signal_data)?;

    let caller_player = ctx
        .db
        .player()
        .identity()
        .find(&caller)
        .ok_or("Caller not found in any room".to_string())?;

    let target_player = ctx
        .db
        .player()
        .identity()
        .find(&to_identity)
        .ok_or("Target player not found".to_string())?;

    if caller_player.room_code != target_player.room_code {
        return Err("Caller and target must be in the same room".to_string());
    }

    if !target_player.is_online {
        return Err("Target is not online".to_string());
    }

    let signal = PeerSignal {
        id: 0,
        from_identity: caller,
        to_identity,
        room_code: caller_player.room_code,
        signal_type,
        signal_data,
        created_at: ctx.timestamp,
    };
    ctx.db.peer_signal().insert(signal);

    log::info!("Signal sent from {} to {}", caller, to_identity);
    Ok(())
}

#[spacetimedb::reducer]
pub fn cleanup_signals(ctx: &ReducerContext, room_code: String) -> Result<(), String> {
    let signals: Vec<PeerSignal> = ctx.db.peer_signal().by_room().filter(&room_code).collect();
    for signal in signals {
        ctx.db.peer_signal().id().delete(&signal.id);
    }

    log::info!("Cleaned up signals for room {}", room_code);
    Ok(())
}

#[spacetimedb::reducer]
pub fn cleanup_signals_for_peer(
    ctx: &ReducerContext,
    peer_identity: Identity,
) -> Result<(), String> {
    let from_signals: Vec<PeerSignal> = ctx
        .db
        .peer_signal()
        .by_from()
        .filter(&peer_identity)
        .collect();
    for signal in from_signals {
        ctx.db.peer_signal().id().delete(&signal.id);
    }

    let to_signals: Vec<PeerSignal> = ctx
        .db
        .peer_signal()
        .by_to()
        .filter(&peer_identity)
        .collect();
    for signal in to_signals {
        ctx.db.peer_signal().id().delete(&signal.id);
    }

    log::info!("Cleaned up signals for peer {}", peer_identity);
    Ok(())
}

#[spacetimedb::reducer]
pub fn update_room_status(
    ctx: &ReducerContext,
    room_code: String,
    status: String,
) -> Result<(), String> {
    let caller = ctx.sender;
    let valid_statuses = ["lobby", "playing", "paused", "game-over"];

    if !valid_statuses.contains(&status.as_str()) {
        return Err(format!(
            "Invalid status. Must be one of: {}",
            valid_statuses.join(", ")
        ));
    }

    let mut room = ctx
        .db
        .room()
        .room_code()
        .find(&room_code)
        .ok_or("Room not found")?;

    let player = ctx
        .db
        .player()
        .identity()
        .find(&caller)
        .ok_or("Not in a room")?;

    if player.room_code != room_code {
        return Err("Not in this room".to_string());
    }

    if !player.is_host {
        return Err("Only host can update room status".to_string());
    }

    room.status = status.clone();
    ctx.db.room().room_code().update(room);

    log::info!("Room {} status updated to {}", room_code, status);
    Ok(())
}
