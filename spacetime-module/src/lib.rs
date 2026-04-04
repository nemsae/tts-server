use spacetimedb::{Identity, Timestamp};

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
