
pub const COLS: i32 = 28;
pub const ROWS: i32 = 16;
const FOODS_PER_LEVEL: i32 = 5;
const MAX_LEVEL: i32 = 9;
const FOOD_SCORE: i32 = 10;
const BONUS_BASE_SCORE: i32 = 20;
const BONUS_LIFETIME_TICKS: i32 = 45;
const BONUS_SPAWN_CHANCE_PCT: i32 = 30;
const BONUS_SIZE: i32 = 2;
const BASE_SPEED_MS: i32 = 160;
const SPEED_STEP_MS: i32 = 12;
const MIN_SPEED_MS: i32 = 55;
const MAX_SPAWN_ATTEMPTS: i32 = 512;

type Cell = (i32, i32);

#[derive(Clone, Copy, PartialEq, Debug)]
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
    Won = 4,
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
    bump: i32,
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
            bump: -1,
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
            || self.in_bonus(x, y)
    }

    fn in_bonus(&self, x: i32, y: i32) -> bool {
        match self.bonus {
            Some(b) => (x - b.x).abs() < BONUS_SIZE && (y - b.y).abs() < BONUS_SIZE,
            None => false,
        }
    }

    fn fits_bonus(&self, x: i32, y: i32) -> bool {
        if x < 0 || y < 0 || x + BONUS_SIZE > COLS || y + BONUS_SIZE > ROWS {
            return false;
        }
        for dy in 0..BONUS_SIZE {
            for dx in 0..BONUS_SIZE {
                let cell = (x + dx, y + dy);
                if cell == self.food || self.occupied(cell.0, cell.1) {
                    return false;
                }
            }
        }
        true
    }

    fn try_free_bonus(&mut self) -> Option<Cell> {
        let mut attempts = 0;
        while attempts < MAX_SPAWN_ATTEMPTS {
            let cell = (self.rand(COLS - 1), self.rand(ROWS - 1));
            if self.fits_bonus(cell.0, cell.1) {
                return Some(cell);
            }
            attempts += 1;
        }
        for y in 0..ROWS - 1 {
            for x in 0..COLS - 1 {
                if self.fits_bonus(x, y) {
                    return Some((x, y));
                }
            }
        }
        None
    }

    fn first_free_cell(&self, avoid: Cell) -> Option<Cell> {
        let total = COLS * ROWS;
        let start = (self.rng % total as u64) as i32;
        let mut i = 0;
        while i < total {
            let k = (start + i) % total;
            let cell = (k % COLS, k / COLS);
            if cell != avoid && !self.occupied(cell.0, cell.1) {
                return Some(cell);
            }
            i += 1;
        }
        None
    }

    fn try_free_cell(&mut self, avoid: Cell) -> Option<Cell> {
        let mut attempts = 0;
        while attempts < MAX_SPAWN_ATTEMPTS {
            let cell = (self.rand(COLS), self.rand(ROWS));
            if cell != avoid && !self.occupied(cell.0, cell.1) {
                return Some(cell);
            }
            attempts += 1;
        }
        self.first_free_cell(avoid)
    }

    fn reset(&mut self, level: i32) {
        self.level = level.max(1);
        self.walls = level_walls((self.level - 1) % MAX_LEVEL + 1);
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
        self.bump = -1;
        self.cause = None;
        self.state = State::Ready;
        self.food = (0, 0);
        if let Some(cell) = self.first_free_cell((0, 0)) {
            self.food = cell;
        }
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
        if self.bump >= 0 {
            self.bump += 1;
            if self.bump as usize >= self.snake.len() {
                self.bump = -1;
            }
        }
        if self.qlen > 0 {
            let d = self.queued[0];
            self.queued[0] = self.queued[1];
            self.qlen -= 1;
            if !opposite(d, self.dir) {
                self.dir = d;
            }
        }
        let head = self.head();
        let nx = (head.0 + self.dir.0).rem_euclid(COLS);
        let ny = (head.1 + self.dir.1).rem_euclid(ROWS);
        if self.walls.contains(&(nx, ny)) {
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
            self.bump = 0;
            ev = 1;
            if self.progress >= FOODS_PER_LEVEL {
                self.level += 1;
                self.state = State::Ready;
                self.reset_keep_score(self.level);
                return 4;
            }
            match self.try_free_cell(self.food) {
                Some(cell) => self.food = cell,
                None => {
                    self.state = State::Won;
                    return 5;
                }
            }
            if self.bonus.is_none() && self.rand(100) < BONUS_SPAWN_CHANCE_PCT {
                if let Some(cell) = self.try_free_bonus() {
                    self.bonus = Some(Bonus {
                        x: cell.0,
                        y: cell.1,
                        ttl: BONUS_LIFETIME_TICKS,
                    });
                }
            }
        } else {
            self.snake.pop();
        }
        if let Some(b) = self.bonus {
            let ate = (nx - b.x).abs() < BONUS_SIZE && (ny - b.y).abs() < BONUS_SIZE;
            if ate {
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
get!(snake_bump, bump);

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
    fn levels_run_past_nine() {
        let mut g = Game::new(1);
        g.reset(9);
        g.state = State::Running;
        g.progress = FOODS_PER_LEVEL - 1;
        let head = g.head();
        g.food = (head.0 + 1, head.1);
        assert_eq!(g.tick(), 4);
        assert_eq!(g.level, 10);
        assert_eq!(g.state, State::Ready);
        assert_eq!(g.walls, level_walls(1));
        assert_eq!(g.speed_ms(), MIN_SPEED_MS);
    }

    #[test]
    fn edges_wrap_instead_of_killing() {
        let mut g = Game::new(1);
        g.reset(1);
        g.state = State::Running;
        g.dir = (-1, 0);
        g.snake = vec![(0, 5), (1, 5), (2, 5)];
        g.food = (10, 10);
        assert_eq!(g.tick(), 0);
        assert_eq!(g.head(), (COLS - 1, 5));
        assert_eq!(g.state, State::Running);
        g.dir = (0, -1);
        g.snake = vec![(27, 0), (27, 1), (27, 2)];
        assert_eq!(g.tick(), 0);
        assert_eq!(g.head(), (27, ROWS - 1));
        assert_eq!(g.state, State::Running);
    }

    #[test]
    fn border_wall_still_kills_after_wrap() {
        let mut g = Game::new(1);
        g.reset(6);
        g.state = State::Running;
        g.snake = vec![(1, 5), (2, 5), (3, 5)];
        g.dir = (-1, 0);
        assert_eq!(g.tick(), 3);
        assert_eq!(g.cause, Some(DeathCause::Wall));
    }

    #[test]
    fn bump_travels_head_to_tail() {
        let mut g = Game::new(1);
        g.state = State::Running;
        let head = g.head();
        g.food = (head.0 + 1, head.1);
        assert_eq!(g.tick(), 1);
        assert_eq!(g.bump, 0);
        g.food = (20, 1);
        g.tick();
        assert_eq!(g.bump, 1);
        g.tick();
        assert_eq!(g.bump, 2);
        g.tick();
        assert_eq!(g.bump, 3);
        g.tick();
        assert_eq!(g.bump, -1);
    }

    #[test]
    fn bonus_bug_spans_two_cells() {
        let mut g = Game::new(1);
        g.reset(1);
        g.state = State::Running;
        g.snake = vec![(5, 5), (6, 5), (7, 5)];
        g.dir = (0, 1);
        g.bonus = Some(Bonus { x: 5, y: 6, ttl: 30 });
        g.food = (20, 12);
        let before = g.score;
        assert_eq!(g.tick(), 2);
        assert_eq!(g.head(), (5, 6));
        assert!(g.score > before);
        assert!(g.bonus.is_none());
    }

    #[test]
    fn spawned_bonus_keeps_clear_of_food_and_body() {
        for seed in 0..30u64 {
            let mut g = Game::new(seed);
            g.state = State::Running;
            for _ in 0..120 {
                let ev = g.tick();
                if ev == 3 || ev == 4 || ev == 5 {
                    break;
                }
                if let Some(b) = g.bonus {
                    for dy in 0..BONUS_SIZE {
                        for dx in 0..BONUS_SIZE {
                            let cell = (b.x + dx, b.y + dy);
                            assert!(!g.snake.contains(&cell));
                            assert!(!g.walls.contains(&cell));
                            assert!(cell != g.food);
                        }
                    }
                }
            }
        }
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

    #[test]
    fn won_when_board_full() {
        let mut g = Game::new(1);
        g.reset(1);
        let food = (10, 8);
        let mut body = vec![(9, 8)];
        for y in 0..ROWS {
            for x in 0..COLS {
                let cell = (x, y);
                if cell != food && cell != (9, 8) {
                    body.push(cell);
                }
            }
        }
        g.snake = body;
        g.food = food;
        g.dir = (1, 0);
        g.state = State::Running;
        assert_eq!(g.tick(), 5);
        assert_eq!(g.state, State::Won);
        assert_eq!(g.cause, None);
        assert_eq!(g.score, FOOD_SCORE);
    }

    #[test]
    fn placements_stay_valid() {
        let dirs = [(1, 0), (0, 1), (-1, 0), (0, -1)];
        for seed in 0..20u64 {
            let mut g = Game::new(seed);
            g.state = State::Running;
            let mut step = 0u64;
            for _ in 0..300 {
                step += 1;
                if step % 7 == 0 {
                    g.queue_dir(dirs[(step / 7) as usize % 4]);
                }
                let ev = g.tick();
                if ev == 3 || ev == 4 || ev == 5 {
                    break;
                }
                assert!(!g.occupied(g.food.0, g.food.1));
                if let Some(b) = g.bonus {
                    assert!(!g.snake.contains(&(b.x, b.y)));
                    assert!(!g.walls.contains(&(b.x, b.y)));
                    assert!((b.x, b.y) != g.food);
                }
            }
        }
    }

    #[test]
    fn queued_turns_apply_in_order() {
        let mut g = Game::new(1);
        g.state = State::Running;
        let start = g.head();
        g.queue_dir((0, -1));
        g.queue_dir((-1, 0));
        g.tick();
        assert_eq!(g.head(), (start.0, start.1 - 1));
        g.tick();
        assert_eq!(g.head(), (start.0 - 1, start.1 - 1));
    }

    #[test]
    fn reset_clears_run_state() {
        let mut g = Game::new(1);
        g.state = State::Running;
        let head = g.head();
        g.food = (head.0 + 1, head.1);
        g.tick();
        g.queue_dir((0, -1));
        g.reset(3);
        assert_eq!(g.score, 10);
        assert_eq!(g.progress, 0);
        assert_eq!(g.bonus, None);
        assert_eq!(g.qlen, 0);
        assert_eq!(g.state, State::Ready);
        assert_eq!(g.level, 3);
        assert_eq!(g.snake.len(), 3);
        unsafe {
            let p: *mut Game = &mut g;
            snake_reset(p, 1);
        }
        assert_eq!(g.score, 0);
        assert_eq!(g.level, 1);
    }

    #[test]
    fn paused_tick_changes_nothing() {
        let mut g = Game::new(1);
        g.state = State::Running;
        g.tick();
        g.state = State::Paused;
        let snapshot = g.snake.clone();
        let score = g.score;
        let food = g.food;
        assert_eq!(g.tick(), 0);
        assert_eq!(g.snake, snapshot);
        assert_eq!(g.score, score);
        assert_eq!(g.food, food);
    }

    #[test]
    fn level_bounds_and_speeds() {
        assert_eq!(level_walls(1).len(), 0);
        assert_eq!(level_walls(6).len(), 84);
        let mut prev = i32::MAX;
        for lvl in 1..=MAX_LEVEL {
            for (x, y) in level_walls(lvl) {
                assert!(x >= 0 && x < COLS && y >= 0 && y < ROWS);
            }
            let mut g = Game::new(1);
            g.reset(lvl);
            let speed = g.speed_ms();
            assert!(speed <= prev);
            prev = speed;
        }
        let mut g = Game::new(1);
        g.reset(0);
        assert_eq!(g.level, 1);
        g.reset(10);
        assert_eq!(g.level, 10);
        assert_eq!(g.walls, level_walls(1));
        g.reset(99);
        assert_eq!(g.level, 99);
        assert_eq!(g.speed_ms(), MIN_SPEED_MS);
        let mut g = Game::new(1);
        g.reset(1);
        assert_eq!(g.speed_ms(), BASE_SPEED_MS);
    }

    #[test]
    fn api_handles_null_and_invalid() {
        use std::ptr;
        unsafe {
            assert_eq!(snake_state(ptr::null_mut()), 0);
            assert_eq!(snake_len(ptr::null_mut()), 0);
            assert_eq!(snake_score(ptr::null_mut()), 0);
            assert_eq!(snake_level(ptr::null_mut()), 0);
            assert_eq!(snake_progress(ptr::null_mut()), 0);
            assert_eq!(snake_bump(ptr::null_mut()), 0);
            assert_eq!(snake_cause(ptr::null_mut()), 0);
            assert_eq!(snake_cell_x(ptr::null_mut(), 0), -1);
            assert_eq!(snake_cell_y(ptr::null_mut(), 0), -1);
            assert_eq!(snake_food_x(ptr::null_mut()), -1);
            assert_eq!(snake_food_y(ptr::null_mut()), -1);
            assert_eq!(snake_bonus_x(ptr::null_mut()), -1);
            assert_eq!(snake_bonus_y(ptr::null_mut()), -1);
            assert_eq!(snake_bonus_ttl(ptr::null_mut()), 0);
            assert_eq!(snake_wall_count(ptr::null_mut()), 0);
            assert_eq!(snake_wall_x(ptr::null_mut(), 0), -1);
            assert_eq!(snake_wall_y(ptr::null_mut(), 0), -1);
            assert_eq!(snake_speed_ms(ptr::null_mut()), 160);
            assert_eq!(snake_tick(ptr::null_mut()), 0);
            snake_destroy(ptr::null_mut());
            snake_set_dir(ptr::null_mut(), 1);
            snake_pause(ptr::null_mut());
            snake_start(ptr::null_mut());
            snake_reset(ptr::null_mut(), 1);
        }
        let mut g = Game::new(1);
        g.state = State::Running;
        let head = g.head();
        unsafe {
            let p: *mut Game = &mut g;
            snake_set_dir(p, 99);
            assert_eq!(snake_cell_x(p, -1), -1);
            assert_eq!(snake_cell_x(p, 9999), -1);
            assert_eq!(snake_wall_x(p, 9999), -1);
        }
        g.tick();
        assert_eq!(g.head(), (head.0 + 1, head.1));
    }
}
