/* Keep the freestanding build independent of a target sysroot. */
typedef signed char int8_t;
typedef unsigned char uint8_t;
typedef unsigned short uint16_t;
typedef int int32_t;
typedef unsigned int uint32_t;
typedef long long int64_t;
typedef unsigned long long uint64_t;
#define UINT64_MAX (~(uint64_t)0)

/*
 * Freestanding, allocation-free scanner compiled to WebAssembly. Its integer
 * overflow and random-number behavior intentionally mirrors native
 * CoordsFinder rather than the host browser's number semantics.
 */
#define EXPORT(name) __attribute__((export_name(name)))

enum {
    MODE_VANILLA_1 = 0,
    MODE_VANILLA_2 = 1,
    MODE_VANILLA_3 = 2,
    MODE_SODIUM_1 = 3,
    MODE_SODIUM_2 = 4,
    SCAN_ORDER_LINEAR = 0,
    SCAN_ORDER_SPIRAL = 1,
    SCAN_ORDER_REVERSE_SPIRAL = 2,
    MAX_DIRECTIONS = 4,
    MAX_FILTERS = 256,
    MAX_BATCH_RESULTS = 1024
};

typedef struct {
    int8_t x;
    int8_t y;
    int8_t z;
    uint16_t accepted_indices;
} Filter;

typedef struct {
    uint64_t ordinal;
    int32_t x;
    int32_t y;
    int32_t z;
    uint16_t bad_blocks;
    uint8_t direction;
} SearchResult;

static Filter directional_filters[MAX_DIRECTIONS][MAX_FILTERS];
static SearchResult batch_results[MAX_BATCH_RESULTS];
static uint8_t directions[MAX_DIRECTIONS];
static uint8_t direction_set[MAX_DIRECTIONS];
static uint16_t direction_filter_counts[MAX_DIRECTIONS];
static uint16_t direction_forced_errors[MAX_DIRECTIONS];

static int32_t search_x_start;
static int32_t search_x_end;
static int32_t search_y_start;
static int32_t search_y_end;
static int32_t search_z_start;
static int32_t search_z_end;
static int32_t cursor_x;
static int32_t cursor_y;
static int32_t cursor_z;
static int32_t search_mode;
static int32_t search_scan_order;
static int32_t search_max_bad_blocks;
static int32_t search_filter_count;
static int32_t search_direction_count;
static int32_t cursor_direction;
static uint32_t batch_result_count;
static uint64_t xz_positions;
static uint64_t cursor_xz_index;
static uint64_t processed_positions;
static uint64_t total_positions;
static uint64_t matching_positions;
static uint8_t search_finished;

typedef struct {
    int32_t dx, dz;
    /* Entry k accepts the low k bits of a measured nibble (k = 0..4). */
    uint16_t possible_x[5], possible_y[5], possible_z[5];
} OffsetFilter;
static OffsetFilter offset_filters[MAX_DIRECTIONS][MAX_FILTERS];
static uint16_t offset_counts[MAX_DIRECTIONS];
static uint32_t offset_bits;
static uint64_t offset_matches, range_end;
static uint32_t prefix_x[27], prefix_z[27], prefix_depth;
static uint64_t prefix_path;
static int32_t prefix_direction;
static uint8_t prefix_cached, candidate_cached;
static uint32_t next_x_choices;

static const uint64_t JAVA_MULTIPLIER = 0x5DEECE66Dull;
static const uint64_t JAVA_MASK = (1ull << 48) - 1ull;
static const uint64_t SODIUM_PHI = 0x9E3779B97F4A7C15ull;

/* Explicit shifts and wrapping helpers make Java/C overflow parity visible. */
static uint64_t unsigned_shift_right(uint64_t value, uint32_t distance)
{
    return value >> distance;
}

static int64_t signed_shift_right(uint64_t value, uint32_t distance)
{
    uint64_t shifted = value >> distance;
    if ((value & (1ull << 63)) != 0) {
        shifted |= (~0ull) << (64 - distance);
    }
    return (int64_t)shifted;
}

static uint64_t rotate_left_64(uint64_t value, uint32_t distance)
{
    return (value << distance) | (value >> (64 - distance));
}

static int32_t wrap_add_i32(int32_t lhs, int32_t rhs)
{
    return (int32_t)((uint32_t)lhs + (uint32_t)rhs);
}

static uint32_t positive_modulo(int32_t value, uint32_t modulus)
{
    int64_t wide = value;
    uint64_t positive = (uint64_t)(wide < 0 ? -wide : wide);
    return (uint32_t)(positive % modulus);
}

/*
 * Keep this check unoptimized so Clang emits wasm's native i64 division.
 * Its optimized overflow intrinsic otherwise pulls in an unavailable i128
 * compiler-runtime helper in this deliberately freestanding module.
 */
__attribute__((noinline, optnone))
static int32_t checked_multiply_u64(
    uint64_t lhs,
    uint64_t rhs,
    uint64_t* result)
{
    if (rhs != 0 && lhs > UINT64_MAX / rhs) return 0;
    *result = lhs * rhs;
    return 1;
}

static uint64_t stafford_mix_13(uint64_t value)
{
    value = (value ^ unsigned_shift_right(value, 30)) *
        0xBF58476D1CE4E5B9ull;
    value = (value ^ unsigned_shift_right(value, 27)) *
        0x94D049BB133111EBull;
    return value ^ unsigned_shift_right(value, 31);
}

static uint64_t coordinate_random_raw(int32_t x, int32_t y, int32_t z)
{
    /*
     * CoordsFinder intentionally performs the x multiplication as a wrapped
     * 32-bit operation before sign-extending it to 64 bits.
     */
    int32_t x_product = (int32_t)((uint32_t)x * 3129871u);
    uint64_t seed = (uint64_t)(int64_t)x_product;
    seed ^= (uint64_t)(int64_t)z * 116129781ull;
    seed ^= (uint64_t)(int64_t)y;
    return seed * seed * 42317861ull + seed * 11ull;
}

static int32_t coordinate_random_legacy(int32_t x, int32_t y, int32_t z)
{
    int32_t low = (int32_t)(uint32_t)coordinate_random_raw(x, y, z);
    return low >> 16;
}

static uint64_t coordinate_random(int32_t x, int32_t y, int32_t z)
{
    return (uint64_t)signed_shift_right(coordinate_random_raw(x, y, z), 16);
}

static int32_t random_vanilla_2(uint64_t seed)
{
    seed = (seed ^ JAVA_MULTIPLIER) & JAVA_MASK;
    uint64_t mixed = seed * 0xBB20B4600A69ull + 0x40942DE6BAull;
    return (int32_t)(uint32_t)unsigned_shift_right(mixed, 16);
}

static uint32_t legacy_next_bits(uint64_t* seed, uint32_t bits)
{
    *seed = (*seed * JAVA_MULTIPLIER + 11ull) & JAVA_MASK;
    return (uint32_t)unsigned_shift_right(*seed, 48 - bits);
}

static uint32_t legacy_next_int(uint64_t seed, uint32_t bound)
{
    seed = (seed ^ JAVA_MULTIPLIER) & JAVA_MASK;

    if ((bound & (0u - bound)) == bound) {
        return (uint32_t)(((uint64_t)bound * legacy_next_bits(&seed, 31)) >> 31);
    }

    uint32_t bits = legacy_next_bits(&seed, 31);
    uint32_t value = bits % bound;
    while ((int64_t)bits - value + (bound - 1u) < 0) {
        bits = legacy_next_bits(&seed, 31);
        value = bits % bound;
    }
    return value;
}

static int32_t random_sodium_1(uint64_t seed)
{
    seed ^= unsigned_shift_right(seed, 33);
    seed *= 0xff51afd7ed558ccdull;
    seed ^= unsigned_shift_right(seed, 33);
    seed *= 0xc4ceb9fe1a85ec53ull;
    seed ^= unsigned_shift_right(seed, 33);

    uint64_t first = stafford_mix_13(seed + SODIUM_PHI);
    uint64_t second = stafford_mix_13(seed + SODIUM_PHI + SODIUM_PHI);
    return (int32_t)(uint32_t)(first + second);
}

static int32_t random_sodium_2(uint64_t seed)
{
    uint64_t low = seed ^ 7640891576956012809ull;
    uint64_t high = low - 7046029254386353131ull;

    low = stafford_mix_13(low);
    high = stafford_mix_13(high);

    return (int32_t)(uint32_t)(rotate_left_64(low + high, 17) + low);
}

static uint32_t texture_variant(
    int32_t mode,
    int32_t x,
    int32_t y,
    int32_t z,
    uint32_t variants)
{
    switch (mode) {
    case MODE_VANILLA_1:
        return positive_modulo(coordinate_random_legacy(x, y, z), variants);
    case MODE_VANILLA_2:
        return positive_modulo(
            random_vanilla_2(coordinate_random(x, y, z)),
            variants);
    case MODE_VANILLA_3:
        return legacy_next_int(coordinate_random(x, y, z), variants);
    case MODE_SODIUM_1:
        return positive_modulo(
            random_sodium_1(coordinate_random(x, y, z)),
            variants);
    case MODE_SODIUM_2:
    default:
        return positive_modulo(
            random_sodium_2(coordinate_random(x, y, z)),
            variants);
    }
}

static uint64_t spiral_positions_through_radius(int64_t radius)
{
    int64_t center_x = (int64_t)search_x_start +
        ((int64_t)search_x_end - search_x_start) / 2;
    int64_t center_z = (int64_t)search_z_start +
        ((int64_t)search_z_end - search_z_start) / 2;
    int64_t min_x = center_x - radius > search_x_start ? center_x - radius : search_x_start;
    int64_t max_x = center_x + radius < search_x_end ? center_x + radius : search_x_end;
    int64_t min_z = center_z - radius > search_z_start ? center_z - radius : search_z_start;
    int64_t max_z = center_z + radius < search_z_end ? center_z + radius : search_z_end;
    uint64_t width = (uint64_t)(max_x - min_x) + 1ull;
    uint64_t height = (uint64_t)(max_z - min_z) + 1ull;
    return width * height;
}

/* Map an X/Z ordinal to the native clockwise, center-out ring traversal. */
static void set_spiral_xz_cursor(uint64_t index)
{
    int64_t center_x = (int64_t)search_x_start +
        ((int64_t)search_x_end - search_x_start) / 2;
    int64_t center_z = (int64_t)search_z_start +
        ((int64_t)search_z_end - search_z_start) / 2;
    int64_t maximum_radius = center_x - search_x_start;
    if (center_z - search_z_start > maximum_radius) maximum_radius = center_z - search_z_start;
    if (search_x_end - center_x > maximum_radius) maximum_radius = search_x_end - center_x;
    if (search_z_end - center_z > maximum_radius) maximum_radius = search_z_end - center_z;
    int64_t low = 0;
    int64_t high = maximum_radius;

    while (low < high) {
        int64_t middle = low + (high - low) / 2;
        if (spiral_positions_through_radius(middle) > index) high = middle;
        else low = middle + 1;
    }

    int64_t radius = low;
    if (radius == 0) {
        cursor_x = (int32_t)center_x;
        cursor_z = (int32_t)center_z;
        return;
    }

    uint64_t offset = index - spiral_positions_through_radius(radius - 1);
    int64_t from;
    int64_t to;
    uint64_t length;

    int64_t right = center_x + radius;
    if (right >= search_x_start && right <= search_x_end) {
        from = center_z - radius + 1 > search_z_start ? center_z - radius + 1 : search_z_start;
        to = center_z + radius < search_z_end ? center_z + radius : search_z_end;
        length = (uint64_t)(to - from) + 1ull;
        if (offset < length) {
            cursor_x = (int32_t)right;
            cursor_z = (int32_t)(from + (int64_t)offset);
            return;
        }
        offset -= length;
    }

    int64_t bottom = center_z + radius;
    if (bottom >= search_z_start && bottom <= search_z_end) {
        from = center_x + radius - 1 < search_x_end ? center_x + radius - 1 : search_x_end;
        to = center_x - radius > search_x_start ? center_x - radius : search_x_start;
        length = (uint64_t)(from - to) + 1ull;
        if (offset < length) {
            cursor_x = (int32_t)(from - (int64_t)offset);
            cursor_z = (int32_t)bottom;
            return;
        }
        offset -= length;
    }

    int64_t left = center_x - radius;
    if (left >= search_x_start && left <= search_x_end) {
        from = center_z + radius - 1 < search_z_end ? center_z + radius - 1 : search_z_end;
        to = center_z - radius > search_z_start ? center_z - radius : search_z_start;
        length = (uint64_t)(from - to) + 1ull;
        if (offset < length) {
            cursor_x = (int32_t)left;
            cursor_z = (int32_t)(from - (int64_t)offset);
            return;
        }
        offset -= length;
    }

    from = center_x - radius + 1 > search_x_start ? center_x - radius + 1 : search_x_start;
    cursor_x = (int32_t)(from + (int64_t)offset);
    cursor_z = (int32_t)(center_z - radius);
}

/* Reverse spiral visits the exact finite spiral sequence in reverse. */
static void set_spiral_order_xz_cursor(uint64_t index)
{
    if (search_scan_order == SCAN_ORDER_REVERSE_SPIRAL) {
        index = xz_positions - 1ull - index;
    }
    set_spiral_xz_cursor(index);
}

/* Linear scans run X -> Z -> direction -> Y, with Y innermost. */
static void advance_cursor(void)
{
    if (cursor_y != search_y_end) {
        cursor_y += 1;
        return;
    }
    cursor_y = search_y_start;

    if (search_scan_order != SCAN_ORDER_LINEAR) {
        if (cursor_direction + 1 < search_direction_count) {
            cursor_direction += 1;
            return;
        }
        cursor_direction = 0;
        cursor_xz_index += 1;
        if (cursor_xz_index < xz_positions) {
            set_spiral_order_xz_cursor(cursor_xz_index);
            return;
        }
        search_finished = 1;
        return;
    }

    if (cursor_direction + 1 < search_direction_count) {
        cursor_direction += 1;
        return;
    }
    cursor_direction = 0;
    if (cursor_z != search_z_end) {
        cursor_z += 1;
        return;
    }
    cursor_z = search_z_start;
    if (cursor_x != search_x_end) {
        cursor_x += 1;
        return;
    }
    cursor_x = search_x_start;
    search_finished = 1;
}

EXPORT("search_configure")
int32_t search_configure(
    int32_t mode,
    int32_t scan_order,
    int32_t x_start,
    int32_t x_end,
    int32_t y_start,
    int32_t y_end,
    int32_t z_start,
    int32_t z_end,
    int32_t max_bad_blocks,
    int32_t filter_count,
    int32_t direction_count)
{
    /* Numeric error codes keep the JS/WASM ABI independent of linear memory. */
    if (mode < MODE_VANILLA_1 || mode > MODE_SODIUM_2) return 1;
    if (scan_order < SCAN_ORDER_LINEAR || scan_order > SCAN_ORDER_REVERSE_SPIRAL) return 7;
    if (x_start > x_end || y_start > y_end || z_start > z_end) return 2;
    if (max_bad_blocks < 0) return 3;
    if (filter_count < 0 || filter_count > MAX_FILTERS) return 4;
    if (direction_count < 1 || direction_count > MAX_DIRECTIONS) return 6;

    uint64_t x_size = (uint64_t)((int64_t)x_end - x_start) + 1ull;
    uint64_t y_size = (uint64_t)((int64_t)y_end - y_start) + 1ull;
    uint64_t z_size = (uint64_t)((int64_t)z_end - z_start) + 1ull;
    uint64_t xy_size;
    uint64_t volume;
    if (!checked_multiply_u64(x_size, y_size, &xy_size)) return 5;
    if (!checked_multiply_u64(xy_size, z_size, &volume)) return 5;
    uint64_t directional_volume;
    if (!checked_multiply_u64(
            volume,
            (uint64_t)direction_count,
            &directional_volume)) {
        return 5;
    }

    search_mode = mode;
    search_scan_order = scan_order;
    search_x_start = x_start;
    search_x_end = x_end;
    search_y_start = y_start;
    search_y_end = y_end;
    search_z_start = z_start;
    search_z_end = z_end;
    search_max_bad_blocks = max_bad_blocks;
    search_filter_count = filter_count;
    search_direction_count = direction_count;
    cursor_direction = 0;
    cursor_y = y_start;
    cursor_xz_index = 0;
    xz_positions = x_size * z_size;
    if (scan_order != SCAN_ORDER_LINEAR) {
        set_spiral_order_xz_cursor(0);
    }
    else {
        cursor_x = x_start;
        cursor_z = z_start;
    }
    batch_result_count = 0;
    processed_positions = 0;
    matching_positions = 0;
    total_positions = directional_volume;
    search_finished = 0;
    offset_bits = 0;
    offset_matches = 0;
    prefix_cached = candidate_cached = 0;
    range_end = total_positions;
    for (int32_t index = 0; index < MAX_DIRECTIONS; index += 1) {
        offset_counts[index] = 0;
        direction_set[index] = 0;
        direction_filter_counts[index] = 0;
        direction_forced_errors[index] = 0;
    }
    return 0;
}

EXPORT("search_set_direction")
int32_t search_set_direction(
    int32_t index,
    int32_t quarter_turns,
    int32_t filter_count,
    int32_t forced_errors)
{
    if (index < 0 || index >= search_direction_count) return 1;
    if (quarter_turns < 0 || quarter_turns > 3) return 2;
    if (filter_count < 0 || filter_count > search_filter_count ||
        forced_errors < 0 || forced_errors > 65535) return 4;

    for (int32_t other = 0; other < search_direction_count; other += 1) {
        if (other != index &&
            direction_set[other] &&
            directions[other] == quarter_turns) {
            return 3;
        }
    }

    directions[index] = (uint8_t)quarter_turns;
    direction_filter_counts[index] = (uint16_t)filter_count;
    direction_forced_errors[index] = (uint16_t)forced_errors;
    direction_set[index] = 1;
    return 0;
}

EXPORT("search_set_filter")
int32_t search_set_filter(
    int32_t direction_index,
    int32_t index,
    int32_t x,
    int32_t y,
    int32_t z,
    int32_t accepted_indices)
{
    if (direction_index < 0 || direction_index >= search_direction_count ||
        index < 0 || index >= direction_filter_counts[direction_index]) return 1;
    if (x < -128 || x > 127 || y < -128 || y > 127 ||
        z < -128 || z > 127) {
        return 2;
    }
    if (accepted_indices < 1 || accepted_indices > 65535) return 3;
    if (!direction_set[direction_index]) return 4;

    Filter* filter = &directional_filters[direction_index][index];
    filter->x = (int8_t)x;
    filter->y = (int8_t)y;
    filter->z = (int8_t)z;
    filter->accepted_indices = (uint16_t)accepted_indices;
    return 0;
}

/* Offset nibbles use the low 32 bits of the coordinate seed at world Y=0.
 * Partial low coordinate bits determine the same low seed bits, enabling exact
 * pruning even when several nibbles share a clipped visible displacement. */
static uint32_t offset_seed(uint32_t x, uint32_t z)
{
    uint32_t seed = (x * 3129871u) ^ (z * 116129781u);
    return seed * seed * 42317861u + seed * 11u;
}

static void prepare_nibble(uint16_t* possible, uint32_t accepted)
{
    for (uint32_t bits = 0; bits <= 4; bits++) {
        uint32_t mask = (1u << bits) - 1u;
        possible[bits] = 0;
        for (uint32_t n = 0; n < 16; n++) {
            if (accepted & (1u << n)) possible[bits] |= 1u << (n & mask);
        }
    }
}

static int offsets_possible(uint32_t x, uint32_t z, uint32_t depth, int direction)
{
    if (depth <= 16) return 1;
    uint32_t x_bits = depth < 20 ? depth - 16 : 4;
    uint32_t y_bits = depth <= 20 ? 0 : depth < 24 ? depth - 20 : 4;
    uint32_t z_bits = depth <= 24 ? 0 : depth < 28 ? depth - 24 : 4;
    uint32_t x_mask = (1u << x_bits) - 1u;
    uint32_t y_mask = (1u << y_bits) - 1u;
    uint32_t z_mask = (1u << z_bits) - 1u;
    for (uint32_t i = 0; i < offset_counts[direction]; i++) {
        OffsetFilter *f = &offset_filters[direction][i];
        uint32_t seed = offset_seed(x + (uint32_t)f->dx, z + (uint32_t)f->dz);
        if (!(f->possible_x[x_bits] & (1u << ((seed >> 16) & x_mask))) ||
            !(f->possible_y[y_bits] & (1u << ((seed >> 20) & y_mask))) ||
            !(f->possible_z[z_bits] & (1u << ((seed >> 24) & z_mask)))) return 0;
    }
    return 1;
}

/* At depth 16 the next X/Z bits toggle seed bit 16 by their XOR, for every
 * observation: both coordinate multipliers and the polynomial's derivative
 * are odd. Intersect the two possible toggles before expanding four children.
 * No observed nibble bits exist below this level, so this is the widest part
 * of the tree. Keep both toggles for clipped/otherwise ambiguous evidence. */
static uint32_t offset_next_x_choices(uint32_t x, uint32_t z, int direction)
{
    uint32_t choices = 3;
    for (uint32_t i = 0; i < offset_counts[direction]; i++) {
        OffsetFilter *f = &offset_filters[direction][i];
        uint32_t allowed = f->possible_x[1];
        if (allowed == 3) continue;
        uint32_t seed = offset_seed(x + (uint32_t)f->dx, z + (uint32_t)f->dz);
        if (seed & (1u << 16)) allowed = ((allowed & 1u) << 1) | (allowed >> 1);
        choices &= allowed;
        if (!choices) break;
    }
    return choices;
}

static int prefix_in_bounds(uint32_t value, uint32_t depth, int32_t minimum, int32_t maximum)
{
    uint32_t mask = (1u << depth) - 1u;
    uint32_t distance = (value - (uint32_t)minimum) & mask;
    return (int64_t)minimum + distance <= maximum;
}

EXPORT("search_configure_offsets")
int32_t search_configure_offsets(uint32_t bits)
{
    if (bits < 1 || bits > 26 || search_x_start < -30000000 || search_x_end > 30000000 ||
        search_z_start < -30000000 || search_z_end > 30000000) return 1;
    int32_t half = 1 << (bits - 1);
    if (search_x_start < -half || search_x_end >= half || search_z_start < -half || search_z_end >= half) return 1;
    uint64_t volume = 1ull << (bits * 2);
    uint64_t y_size = (uint64_t)((int64_t)search_y_end - search_y_start) + 1ull;
    if (!checked_multiply_u64(volume, y_size, &volume) ||
        !checked_multiply_u64(volume, search_direction_count, &volume)) return 2;
    offset_bits = bits;
    prefix_cached = candidate_cached = 0;
    total_positions = volume;
    range_end = volume;
    return 0;
}

EXPORT("search_set_offset")
int32_t search_set_offset(int32_t direction, uint32_t index, int32_t dx, int32_t dz,
                         uint32_t accepted_x, uint32_t accepted_y, uint32_t accepted_z)
{
    if (direction < 0 || direction >= search_direction_count || index >= MAX_FILTERS ||
        accepted_x == 0 || accepted_x > 65535 || accepted_y == 0 || accepted_y > 65535 ||
        accepted_z == 0 || accepted_z > 65535) return 1;
    OffsetFilter *f = &offset_filters[direction][index];
    f->dx = dx; f->dz = dz;
    prepare_nibble(f->possible_x, accepted_x);
    prepare_nibble(f->possible_y, accepted_y);
    prepare_nibble(f->possible_z, accepted_z);
    prefix_cached = candidate_cached = 0;
    if (index >= offset_counts[direction]) offset_counts[direction] = index + 1;
    return 0;
}

EXPORT("search_set_range_end")
int32_t search_set_range_end(uint64_t end)
{
    if (end > total_positions || end < processed_positions) return 1;
    range_end = end;
    return 0;
}

EXPORT("search_restore_offset_matches")
void search_restore_offset_matches(uint64_t count) { offset_matches = count; }
EXPORT("search_get_offset_matches")
uint64_t search_get_offset_matches(void) { return offset_matches; }

/* A base-four ordinal visits low X/Z bits first. Failed prefixes skip their
 * entire subtree, including Y. The ordinal alone restores any worker cursor;
 * shard boundaries can cut through subtrees or Y loops without losing work. */
static int lifted_cursor(void)
{
    uint64_t y_size = (uint64_t)((int64_t)search_y_end - search_y_start) + 1ull;
    uint64_t per_direction = (1ull << (offset_bits * 2)) * y_size;
    cursor_direction = processed_positions / per_direction;
    uint64_t within = processed_positions % per_direction;
    uint64_t path = within / y_size;
    cursor_y = (int32_t)((int64_t)search_y_start + (int64_t)(within % y_size));
    /* Adjacent ordinals share most of their already-validated prefixes. Reuse
     * those nodes, and reuse a fully checked X/Z candidate throughout its Y
     * loop. Restoration invalidates this disposable cache. */
    uint32_t common = 0;
    if (prefix_cached && prefix_direction == cursor_direction) {
        uint64_t changed = path ^ prefix_path;
        if (!changed && candidate_cached) return 1;
        common = changed ? offset_bits - (64u - __builtin_clzll(changed) + 1u) / 2u : offset_bits;
        if (common > prefix_depth) common = prefix_depth;
    }
    prefix_cached = 1;
    candidate_cached = 0;
    prefix_path = path;
    prefix_direction = cursor_direction;
    uint32_t x = prefix_x[common], z = prefix_z[common];
    for (uint32_t depth = common + 1; depth <= offset_bits; depth++) {
        uint32_t shift = 2 * (offset_bits - depth);
        uint32_t option = (path >> shift) & 3;
        x |= (option & 1u) << (depth - 1);
        z |= (option >> 1) << (depth - 1);
        prefix_x[depth] = x;
        prefix_z[depth] = z;
        int possible = depth == 17
            ? (next_x_choices & (1u << ((option & 1u) ^ (option >> 1)))) != 0
            : offsets_possible(x, z, depth, cursor_direction);
        if (depth == 16 && offset_bits > 16) {
            next_x_choices = offset_next_x_choices(x, z, cursor_direction);
            possible = next_x_choices != 0;
        }
        if (!prefix_in_bounds(x, depth, search_x_start, search_x_end) ||
            !prefix_in_bounds(z, depth, search_z_start, search_z_end) ||
            !possible) {
            uint64_t subtree = (1ull << shift) * y_size;
            uint64_t next = processed_positions + subtree - within % subtree;
            processed_positions = next < range_end ? next : range_end;
            prefix_depth = depth - 1;
            return 0;
        }
    }
    prefix_depth = offset_bits;
    /* Sign extension supplies the unknown high bits for the final exact check. */
    uint32_t sign = 1u << (offset_bits - 1);
    cursor_x = (int32_t)((x ^ sign) - sign);
    cursor_z = (int32_t)((z ^ sign) - sign);
    if (!offsets_possible((uint32_t)cursor_x, (uint32_t)cursor_z, 32, cursor_direction)) {
        uint64_t next = processed_positions + y_size - within % y_size;
        processed_positions = next < range_end ? next : range_end;
        return 0;
    }
    /* Count X/Z-and-direction matches once, independent of Y and texture hits. */
    if (within % y_size == 0) offset_matches++;
    candidate_cached = 1;
    return 1;
}

EXPORT("search_restore")
int32_t search_restore(uint64_t processed, uint64_t matches)
{
    if (processed > total_positions) return 1;
    if (matches > processed) return 2;

    processed_positions = processed;
    matching_positions = matches;
    batch_result_count = 0;
    prefix_cached = candidate_cached = 0;

    if (offset_bits) {
        search_finished = processed >= range_end;
        return 0;
    }

    if (processed == total_positions) {
        search_finished = 1;
        return 0;
    }

    uint64_t y_size =
        (uint64_t)((int64_t)search_y_end - search_y_start) + 1ull;
    uint64_t z_size =
        (uint64_t)((int64_t)search_z_end - search_z_start) + 1ull;

    if (search_scan_order != SCAN_ORDER_LINEAR) {
        uint64_t positions_per_xz = y_size * (uint64_t)search_direction_count;
        cursor_xz_index = processed / positions_per_xz;
        uint64_t within_xz = processed % positions_per_xz;
        cursor_direction = (int32_t)(within_xz / y_size);
        cursor_y = (int32_t)((int64_t)search_y_start +
            (int64_t)(within_xz % y_size));
        set_spiral_order_xz_cursor(cursor_xz_index);
    }
    else {
        /* advance_cursor visits Y before direction within each X/Z point. */
        uint64_t positions_per_xz =
            y_size * (uint64_t)search_direction_count;
        uint64_t xz_index = processed / positions_per_xz;
        uint64_t within_xz = processed % positions_per_xz;
        uint64_t x_index = xz_index / z_size;
        uint64_t z_index = xz_index % z_size;

        cursor_direction = (int32_t)(within_xz / y_size);
        uint64_t y_index = within_xz % y_size;

        cursor_x = (int32_t)((int64_t)search_x_start + (int64_t)x_index);
        cursor_y = (int32_t)((int64_t)search_y_start + (int64_t)y_index);
        cursor_z = (int32_t)((int64_t)search_z_start + (int64_t)z_index);
    }
    search_finished = 0;
    return 0;
}

EXPORT("search_scan_batch")
uint32_t search_scan_batch(uint32_t max_positions, uint32_t capture_limit)
{
    uint32_t scanned = 0;
    batch_result_count = 0;
    if (capture_limit > MAX_BATCH_RESULTS) capture_limit = MAX_BATCH_RESULTS;

    while (!search_finished && processed_positions < range_end && scanned < max_positions) {
        scanned += 1;
        if (offset_bits && !lifted_cursor()) {
            search_finished = processed_positions >= range_end;
            continue;
        }
        int32_t bad_blocks = direction_forced_errors[cursor_direction];

        for (int32_t index = 0;
             bad_blocks <= search_max_bad_blocks &&
             index < direction_filter_counts[cursor_direction];
             index += 1) {
            Filter filter = directional_filters[cursor_direction][index];
            int32_t x = wrap_add_i32(cursor_x, filter.x);
            int32_t y = wrap_add_i32(cursor_y, filter.y);
            int32_t z = wrap_add_i32(cursor_z, filter.z);
            uint32_t model_index = texture_variant(search_mode, x, y, z, 16);

            if ((filter.accepted_indices & (1u << model_index)) == 0) {
                bad_blocks += 1;
                if (bad_blocks > search_max_bad_blocks) break;
            }
        }

        if (bad_blocks <= search_max_bad_blocks) {
            matching_positions += 1;
            /* Count every match exactly even after the UI capture cap fills. */
            if (batch_result_count < capture_limit) {
                SearchResult* result = &batch_results[batch_result_count];
                result->ordinal = processed_positions;
                result->x = cursor_x;
                result->y = cursor_y;
                result->z = cursor_z;
                result->bad_blocks = (uint16_t)bad_blocks;
                result->direction = directions[cursor_direction];
                batch_result_count += 1;
            }
        }

        processed_positions += 1;
        if (!offset_bits) advance_cursor();
        if (processed_positions >= range_end) search_finished = 1;
    }

    return scanned;
}

EXPORT("search_is_finished")
int32_t search_is_finished(void)
{
    return search_finished;
}

EXPORT("search_get_processed")
uint64_t search_get_processed(void)
{
    return processed_positions;
}

EXPORT("search_get_total")
uint64_t search_get_total(void)
{
    return total_positions;
}

EXPORT("search_get_match_count")
uint64_t search_get_match_count(void)
{
    return matching_positions;
}

EXPORT("search_get_result_count")
uint32_t search_get_result_count(void)
{
    return batch_result_count;
}

EXPORT("search_get_result_ordinal")
uint64_t search_get_result_ordinal(uint32_t index)
{
    return index < batch_result_count ? batch_results[index].ordinal : 0;
}

EXPORT("search_get_result_x")
int32_t search_get_result_x(uint32_t index)
{
    return index < batch_result_count ? batch_results[index].x : 0;
}

EXPORT("search_get_result_y")
int32_t search_get_result_y(uint32_t index)
{
    return index < batch_result_count ? batch_results[index].y : 0;
}

EXPORT("search_get_result_z")
int32_t search_get_result_z(uint32_t index)
{
    return index < batch_result_count ? batch_results[index].z : 0;
}

EXPORT("search_get_result_bad_blocks")
int32_t search_get_result_bad_blocks(uint32_t index)
{
    return index < batch_result_count ? batch_results[index].bad_blocks : 0;
}

EXPORT("search_get_result_direction")
int32_t search_get_result_direction(uint32_t index)
{
    return index < batch_result_count
        ? (int32_t)batch_results[index].direction * 90
        : 0;
}
