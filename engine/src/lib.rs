
pub const COLS: i32 = 28;
pub const ROWS: i32 = 16;
const FOODS_PER_LEVEL: i32 = 5;
const MAX_LEVEL: i32 = 9;
const FOOD_SCORE: i32 = 10;
const BONUS_BASE_SCORE: i32 = 20;
const BONUS_LIFETIME_TICKS: i32 = 45;
const BONUS_SPAWN_CHANCE_PCT: i32 = 30;
const BASE_SPEED_MS: i32 = 160;
const SPEED_STEP_MS: i32 = 12;
const MIN_SPEED_MS: i32 = 70;
const MAX_SPAWN_ATTEMPTS: i32 = 512;

type Cell = (i32, i32);

#[derive(Clone, Copy)]
struct Bonus {
    x: i32,
    y: i32,
    ttl: i32,
}

#[repr(i32)]
#[derive(Clone, Copy, PartialEq, Debug)]
enum DeathCause {
    Wall = 1,
    SelfHit = 2,
}

#[repr(i32)]
#[derive(Clone, Copy, PartialEq, Debug)]
enum State {
    Ready = 0,
    Running = 1,
    Paused = 2,
    Over = 3,
}

pub struct Game {
    snake: Vec<Cell>,
    dir: Cell,
    queued: [Cell; 2],
    qlen: usize,
    food: Cell,
    bonus: Option<Bonus>,
    walls: Vec<Cell>,
    score: i32,
    level: i32,
    progress: i32,
    state: State,
    cause: Option<DeathCause>,
    rng: u64,
}

fn opposite(a: Cell, b: Cell) -> bool {
    a.0 == -b.0 && a.1 == -b.1
}

fn hbar(w: &mut Vec<Cell>, row: i32, c0: i32, c1: i32) {
    for c in c0..=c1 {
        w.push((c, row));
    }
}

fn vbar(w: &mut Vec<Cell>, col: i32, r0: i32, r1: i32) {
    for r in r0..=r1 {
        w.push((col, r));
    }
}

fn level_walls(level: i32) -> Vec<Cell> {
    let mut w = Vec::new();
    match level {
        2 => {
            hbar(&mut w, 7, 8, 19);
        }
        3 => {
            vbar(&mut w, 7, 4, 11);
            vbar(&mut w, 20, 4, 11);
        }
        4 => {
            for c in 3..=6 {
                for r in 3..=4 {
                    w.push((c, r));
                    w.push((c, ROWS - 1 - r));
                    w.push((COLS - 1 - c, r));
                    w.push((COLS - 1 - c, ROWS - 1 - r));
                }
            }
        }
        5 => {
            hbar(&mut w, 7, 4, 23);
            vbar(&mut w, 13, 3, 12);
            vbar(&mut w, 14, 3, 12);
        }
        6 => {
            for c in 0..COLS {
                w.push((c, 0));
                w.push((c, ROWS - 1));
            }
            for r in 1..ROWS - 1 {
                w.push((0, r));
                w.push((COLS - 1, r));
            }
        }
        7 => {
            hbar(&mut w, 4, 4, 15);
            hbar(&mut w, 11, 12, 23);
            vbar(&mut w, 19, 5, 10);
            vbar(&mut w, 8, 5, 10);
        }
        8 => {
            for c in 9..=18 {
                w.push((c, 5));
                w.push((c, 10));
            }
            for r in 6..=9 {
                w.push((9, r));
                w.push((18, r));
            }
        }
        _ if level >= 9 => {
            hbar(&mut w, 7, 2, 25);
            vbar(&mut w, 6, 2, 13);
            vbar(&mut w, 21, 2, 13);
            for c in 2..=4 {
                for r in 2..=3 {
                    w.push((c, r));
                    w.push((COLS - 1 - c, ROWS - 1 - r));
                }
            }
        }
        _ => {}
    }
    w
}

impl Game {
    fn new(seed: u64) -> Self {
        let mut g = Game {
            snake: Vec::new(),
            dir: (1, 0),
            queued: [(1, 0); 2],
            qlen: 0,
            food: (0, 0),
            bonus: None,
            walls: Vec::new(),
            score: 0,
            level: 1,
            progress: 0,
            state: State::Ready,
            cause: None,
            rng: if seed == 0 { 0x9E3779B97F4A7C15 } else { seed },
        };
        g.reset(1);
        g
    }

    fn rand(&mut self, n: i32) -> i32 {
        self.rng = self.rng.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.rng;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        ((z ^ (z >> 31)) % (n as u64)) as i32
    }

    fn occupied(&self, x: i32, y: i32) -> bool {
        self.snake.iter().any(|&(sx, sy)| sx == x && sy == y)
            || self.walls.iter().any(|&(wx, wy)| wx == x && wy == y)
    }

    fn free_cell(&mut self) -> Cell {
        for _ in 0..MAX_SPAWN_ATTEMPTS {
            let x = self.rand(COLS);
            let y = self.rand(ROWS);
            if !self.occupied(x, y) && (x, y) != self.food {
                return (x, y);
            }
        }
        (1, 1)
    }

    fn reset(&mut self, level: i32) {
        self.level = level.clamp(1, MAX_LEVEL);
        self.walls = level_walls(self.level);
        let mut spawn = None;
        let mut rows: Vec<i32> = (0..ROWS).collect();
        rows.sort_by_key(|&r| (r - ROWS / 2).abs());
        'outer: for r in rows {
            for c in 2..COLS - 5 {
                if (0..4).all(|k| !self.walls.contains(&(c + k, r))) {
                    spawn = Some((c, r));
                    break 'outer;
                }
            }
        }
        let (sx, sy) = spawn.unwrap_or((4, ROWS / 2));
        self.snake = vec![(sx + 2, sy), (sx + 1, sy), (sx, sy)];
        self.dir = (1, 0);
        self.queued = [(1, 0); 2];
        self.qlen = 0;
        self.progress = 0;
        self.bonus = None;
        self.cause = None;
        self.state = State::Ready;
        self.food = (0, 0);
        self.food = self.free_cell();
    }

    fn queue_dir(&mut self, d: Cell) {
        let last = if self.qlen > 0 {
            self.queued[self.qlen - 1]
        } else {
            self.dir
        };
        if d == last || opposite(d, last) || self.qlen >= 2 {
            return;
        }
        self.queued[self.qlen] = d;
        self.qlen += 1;
    }

    fn head(&self) -> Cell {
        self.snake[0]
    }

    fn tick(&mut self) -> i32 {
        if self.state == State::Paused || self.state == State::Over {
            return 0;
        }
        self.state = State::Running;
        if self.qlen > 0 {
            let d = self.queued[0];
            self.queued[0] = self.queued[1];
            self.qlen -= 1;
            if !opposite(d, self.dir) {
                self.dir = d;
            }
        }
        let head = self.head();
        let nx = head.0 + self.dir.0;
        let ny = head.1 + self.dir.1;
        if nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS
            || self.walls.contains(&(nx, ny))
        {
            self.state = State::Over;
            self.cause = Some(DeathCause::Wall);
            return 3;
        }
        let grew_eat = (nx, ny) == self.food;
        let body = if grew_eat {
            &self.snake[..]
        } else {
            &self.snake[..self.snake.len() - 1]
        };
        if body.contains(&(nx, ny)) {
            self.state = State::Over;
            self.cause = Some(DeathCause::SelfHit);
            return 3;
        }
        self.snake.insert(0, (nx, ny));
        let mut ev = 0;
        if grew_eat {
            self.score += FOOD_SCORE;
            self.progress += 1;
            ev = 1;
            self.food = self.free_cell();
            if self.bonus.is_none() && self.rand(100) < BONUS_SPAWN_CHANCE_PCT {
                let (bx, by) = self.free_cell();
                self.bonus = Some(Bonus { x: bx, y: by, ttl: BONUS_LIFETIME_TICKS });
            }
            if self.progress >= FOODS_PER_LEVEL {
                if self.level < MAX_LEVEL {
                    self.level += 1;
                    self.state = State::Ready;
                    self.reset_keep_score(self.level);
                    return 4;
                } else {
                    self.progress = 0;
                }
            }
        } else {
            self.snake.pop();
        }
        if let Some(b) = self.bonus {
            if (nx, ny) == (b.x, b.y) {
                self.score += BONUS_BASE_SCORE + b.ttl;
                self.bonus = None;
                ev = 2;
            } else if b.ttl <= 1 {
                self.bonus = None;
            } else {
                self.bonus = Some(Bonus { ttl: b.ttl - 1, ..b });
            }
        }
        ev
    }

    fn reset_keep_score(&mut self, level: i32) {
        let s = self.score;
        self.reset(level);
        self.score = s;
    }

    fn speed_ms(&self) -> i32 {
        (BASE_SPEED_MS - (self.level - 1) * SPEED_STEP_MS).max(MIN_SPEED_MS)
    }
}

#[no_mangle]
pub extern "C" fn snake_create(seed: u64) -> *mut Game {
    Box::into_raw(Box::new(Game::new(seed)))
}

#[no_mangle]
pub unsafe extern "C" fn snake_destroy(p: *mut Game) {
    if !p.is_null() {
        drop(Box::from_raw(p));
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_reset(p: *mut Game, level: i32) {
    if let Some(g) = p.as_mut() {
        g.reset(level);
        g.score = 0;
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_set_dir(p: *mut Game, d: i32) {
    if let Some(g) = p.as_mut() {
        let v = match d {
            0 => (0, -1),
            1 => (1, 0),
            2 => (0, 1),
            3 => (-1, 0),
            _ => return,
        };
        g.queue_dir(v);
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_start(p: *mut Game) {
    if let Some(g) = p.as_mut() {
        if g.state == State::Ready || g.state == State::Paused {
            g.state = State::Running;
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_pause(p: *mut Game) {
    if let Some(g) = p.as_mut() {
        if g.state == State::Running {
            g.state = State::Paused;
        } else if g.state == State::Paused {
            g.state = State::Running;
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_tick(p: *mut Game) -> i32 {
    match p.as_mut() {
        Some(g) => g.tick(),
        None => 0,
    }
}

macro_rules! get {
    ($name:ident, $field:ident) => {
        #[no_mangle]
        pub unsafe extern "C" fn $name(p: *mut Game) -> i32 {
            match p.as_ref() {
                Some(g) => g.$field,
                None => 0,
            }
        }
    };
}

get!(snake_score, score);
get!(snake_level, level);
get!(snake_progress, progress);

#[no_mangle]
pub unsafe extern "C" fn snake_cause(p: *mut Game) -> i32 {
    match p.as_ref().and_then(|g| g.cause) {
        None => 0,
        Some(c) => c as i32,
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_state(p: *mut Game) -> i32 {
    match p.as_ref() {
        Some(g) => g.state as i32,
        None => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_len(p: *mut Game) -> i32 {
    match p.as_ref() {
        Some(g) => g.snake.len() as i32,
        None => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_cell_x(p: *mut Game, i: i32) -> i32 {
    match p.as_ref() {
        Some(g) => g.snake.get(i as usize).map(|c| c.0).unwrap_or(-1),
        None => -1,
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_cell_y(p: *mut Game, i: i32) -> i32 {
    match p.as_ref() {
        Some(g) => g.snake.get(i as usize).map(|c| c.1).unwrap_or(-1),
        None => -1,
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_food_x(p: *mut Game) -> i32 {
    match p.as_ref() {
        Some(g) => g.food.0,
        None => -1,
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_food_y(p: *mut Game) -> i32 {
    match p.as_ref() {
        Some(g) => g.food.1,
        None => -1,
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_bonus_x(p: *mut Game) -> i32 {
    match p.as_ref() {
        Some(g) => g.bonus.map(|b| b.x).unwrap_or(-1),
        None => -1,
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_bonus_y(p: *mut Game) -> i32 {
    match p.as_ref() {
        Some(g) => g.bonus.map(|b| b.y).unwrap_or(-1),
        None => -1,
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_bonus_ttl(p: *mut Game) -> i32 {
    match p.as_ref() {
        Some(g) => g.bonus.map(|b| b.ttl).unwrap_or(0),
        None => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_wall_count(p: *mut Game) -> i32 {
    match p.as_ref() {
        Some(g) => g.walls.len() as i32,
        None => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_wall_x(p: *mut Game, i: i32) -> i32 {
    match p.as_ref() {
        Some(g) => g.walls.get(i as usize).map(|c| c.0).unwrap_or(-1),
        None => -1,
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_wall_y(p: *mut Game, i: i32) -> i32 {
    match p.as_ref() {
        Some(g) => g.walls.get(i as usize).map(|c| c.1).unwrap_or(-1),
        None => -1,
    }
}

#[no_mangle]
pub unsafe extern "C" fn snake_speed_ms(p: *mut Game) -> i32 {
    match p.as_ref() {
        Some(g) => g.speed_ms(),
        None => 160,
    }
}

#[no_mangle]
pub extern "C" fn snake_cols() -> i32 {
    COLS
}

#[no_mangle]
pub extern "C" fn snake_rows() -> i32 {
    ROWS
}

#[no_mangle]
pub extern "C" fn snake_goal() -> i32 {
    FOODS_PER_LEVEL
}

#[no_mangle]
pub extern "C" fn snake_max_level() -> i32 {
    MAX_LEVEL
}

#[cfg(test)]
mod tests {
    use super::*;

    const BORDER_LEVEL: i32 = 6;

    #[test]
    fn moves_and_grows_on_food() {
        let mut g = Game::new(1);
        g.state = State::Running;
        let head = g.head();
        g.food = (head.0 + 1, head.1);
        let len = g.snake.len();
        assert_eq!(g.tick(), 1);
        assert_eq!(g.snake.len(), len + 1);
        assert_eq!(g.score, FOOD_SCORE);
    }

    #[test]
    fn wall_kills() {
        let mut g = Game::new(1);
        g.reset(BORDER_LEVEL);
        g.state = State::Running;
        for _ in 0..30 {
            if g.tick() == 3 {
                break;
            }
        }
        assert_eq!(g.state, State::Over);
        assert_eq!(g.cause, Some(DeathCause::Wall));
    }

    #[test]
    fn self_collision_kills() {
        let mut g = Game::new(1);
        g.state = State::Running;
        g.snake = vec![(5, 5), (5, 6), (6, 6), (6, 5), (6, 4)];
        g.dir = (0, 1);
        assert_eq!(g.tick(), 3);
        assert_eq!(g.cause, Some(DeathCause::SelfHit));
    }

    #[test]
    fn level_up_after_goal() {
        let mut g = Game::new(1);
        g.state = State::Running;
        g.progress = FOODS_PER_LEVEL - 1;
        let head = g.head();
        g.food = (head.0 + 1, head.1);
        assert_eq!(g.tick(), 4);
        assert_eq!(g.level, 2);
        assert_eq!(g.score, FOOD_SCORE);
        assert_eq!(g.state, State::Ready);
        assert!(g.speed_ms() < BASE_SPEED_MS);
    }

    #[test]
    fn no_reverse() {
        let mut g = Game::new(1);
        g.state = State::Running;
        g.queue_dir((-1, 0));
        let head = g.head();
        g.tick();
        assert_eq!(g.head().0, head.0 + 1);
    }

    #[test]
    fn all_levels_have_spawn_room_and_food_free() {
        for lvl in 1..=MAX_LEVEL {
            let mut g = Game::new(7);
            g.reset(lvl as i32);
            assert_eq!(g.snake.len(), 3);
            assert!(!g.occupied(g.food.0, g.food.1));
            assert!(!g.walls.contains(&g.snake[0]));
        }
    }
}
