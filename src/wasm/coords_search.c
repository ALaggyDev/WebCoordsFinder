#include <stdint.h>

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
    MAX_DIRECTIONS = 4,
    MAX_FILTERS = 256,
    MAX_BATCH_RESULTS = 1024
};

typedef struct {
    int8_t x;
    int8_t y;
    int8_t z;
    uint8_t rotation;
    uint8_t visible_mask;
} Filter;

typedef struct {
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
static int32_t search_max_bad_blocks;
static int32_t search_filter_count;
static int32_t search_direction_count;
static int32_t cursor_direction;
static uint32_t batch_result_count;
static uint64_t positions_per_direction;
static uint64_t processed_positions;
static uint64_t total_positions;
static uint64_t matching_positions;
static uint8_t search_finished;

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
    int32_t z)
{
    switch (mode) {
    case MODE_VANILLA_1:
        return positive_modulo(coordinate_random_legacy(x, y, z), 4);
    case MODE_VANILLA_2:
        return positive_modulo(
            random_vanilla_2(coordinate_random(x, y, z)),
            4);
    case MODE_VANILLA_3:
        return legacy_next_int(coordinate_random(x, y, z), 4);
    case MODE_SODIUM_1:
        return positive_modulo(
            random_sodium_1(coordinate_random(x, y, z)),
            4);
    case MODE_SODIUM_2:
    default:
        return positive_modulo(
            random_sodium_2(coordinate_random(x, y, z)),
            4);
    }
}

/*
 * Cursor order is X, then Y, then Z, then direction. search_restore relies on
 * this exact ordering to recover a cursor from the processed-position count.
 */
static void advance_cursor(void)
{
    if (cursor_x != search_x_end) {
        cursor_x += 1;
        return;
    }
    cursor_x = search_x_start;

    if (cursor_y != search_y_end) {
        cursor_y += 1;
        return;
    }
    cursor_y = search_y_start;

    if (cursor_z != search_z_end) {
        cursor_z += 1;
        return;
    }

    if (cursor_direction + 1 < search_direction_count) {
        cursor_direction += 1;
        cursor_x = search_x_start;
        cursor_y = search_y_start;
        cursor_z = search_z_start;
        return;
    }

    search_finished = 1;
}

EXPORT("search_configure")
int32_t search_configure(
    int32_t mode,
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
    if (x_start > x_end || y_start > y_end || z_start > z_end) return 2;
    if (max_bad_blocks < 0) return 3;
    if (filter_count < 1 || filter_count > MAX_FILTERS) return 4;
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
    cursor_x = x_start;
    cursor_y = y_start;
    cursor_z = z_start;
    batch_result_count = 0;
    positions_per_direction = volume;
    processed_positions = 0;
    matching_positions = 0;
    total_positions = directional_volume;
    search_finished = 0;
    for (int32_t index = 0; index < MAX_DIRECTIONS; index += 1) {
        direction_set[index] = 0;
    }
    return 0;
}

EXPORT("search_set_direction")
int32_t search_set_direction(int32_t index, int32_t quarter_turns)
{
    if (index < 0 || index >= search_direction_count) return 1;
    if (quarter_turns < 0 || quarter_turns > 3) return 2;

    for (int32_t other = 0; other < search_direction_count; other += 1) {
        if (other != index &&
            direction_set[other] &&
            directions[other] == quarter_turns) {
            return 3;
        }
    }

    directions[index] = (uint8_t)quarter_turns;
    direction_set[index] = 1;
    return 0;
}

EXPORT("search_set_filter")
int32_t search_set_filter(
    int32_t index,
    int32_t x,
    int32_t y,
    int32_t z,
    int32_t rotation,
    int32_t visible_mask)
{
    if (index < 0 || index >= search_filter_count) return 1;
    if (x < -128 || x > 127 || y < -128 || y > 127 ||
        z < -128 || z > 127) {
        return 2;
    }
    if ((visible_mask != 1 && visible_mask != 3) ||
        rotation < 0 || rotation > visible_mask) {
        return 3;
    }

    for (int32_t direction_index = 0;
         direction_index < search_direction_count;
         direction_index += 1) {
        if (!direction_set[direction_index]) return 4;

        int32_t directional_x;
        int32_t directional_z;
        int32_t quarter_turns = directions[direction_index];
        switch (quarter_turns) {
        case 1:
            directional_x = -z;
            directional_z = x;
            break;
        case 2:
            directional_x = -x;
            directional_z = -z;
            break;
        case 3:
            directional_x = z;
            directional_z = -x;
            break;
        case 0:
        default:
            directional_x = x;
            directional_z = z;
            break;
        }
        if (directional_x < -128 || directional_x > 127 ||
            directional_z < -128 || directional_z > 127) {
            return 2;
        }

        Filter* filter = &directional_filters[direction_index][index];
        /*
         * Four-state variants rotate with the search direction. Folded side
         * variants remain the same two-state observation after X/Z rotation.
         */
        filter->x = (int8_t)directional_x;
        filter->y = (int8_t)y;
        filter->z = (int8_t)directional_z;
        filter->rotation = (uint8_t)(
            visible_mask == 3
                ? (rotation + quarter_turns) % 4
                : rotation);
        filter->visible_mask = (uint8_t)visible_mask;
    }
    return 0;
}

EXPORT("search_restore")
int32_t search_restore(uint64_t processed, uint64_t matches)
{
    if (processed > total_positions) return 1;
    if (matches > processed) return 2;

    processed_positions = processed;
    matching_positions = matches;
    batch_result_count = 0;

    if (processed == total_positions) {
        search_finished = 1;
        return 0;
    }

    uint64_t directional_processed = processed % positions_per_direction;
    cursor_direction = (int32_t)(processed / positions_per_direction);
    uint64_t x_size =
        (uint64_t)((int64_t)search_x_end - search_x_start) + 1ull;
    uint64_t y_size =
        (uint64_t)((int64_t)search_y_end - search_y_start) + 1ull;
    uint64_t xy_size = x_size * y_size;
    uint64_t z_index = directional_processed / xy_size;
    uint64_t within_z = directional_processed % xy_size;
    uint64_t y_index = within_z / x_size;
    uint64_t x_index = within_z % x_size;

    cursor_x = (int32_t)((int64_t)search_x_start + (int64_t)x_index);
    cursor_y = (int32_t)((int64_t)search_y_start + (int64_t)y_index);
    cursor_z = (int32_t)((int64_t)search_z_start + (int64_t)z_index);
    search_finished = 0;
    return 0;
}

EXPORT("search_scan_batch")
uint32_t search_scan_batch(uint32_t max_positions, uint32_t capture_limit)
{
    uint32_t scanned = 0;
    batch_result_count = 0;
    if (capture_limit > MAX_BATCH_RESULTS) capture_limit = MAX_BATCH_RESULTS;

    while (!search_finished && scanned < max_positions) {
        int32_t bad_blocks = 0;

        for (int32_t index = 0; index < search_filter_count; index += 1) {
            Filter filter = directional_filters[cursor_direction][index];
            int32_t x = wrap_add_i32(cursor_x, filter.x);
            int32_t y = wrap_add_i32(cursor_y, filter.y);
            int32_t z = wrap_add_i32(cursor_z, filter.z);
            uint32_t visible_variant =
                texture_variant(search_mode, x, y, z) & filter.visible_mask;

            if (visible_variant != filter.rotation) {
                bad_blocks += 1;
                if (bad_blocks > search_max_bad_blocks) break;
            }
        }

        if (bad_blocks <= search_max_bad_blocks) {
            matching_positions += 1;
            /* Count every match exactly even after the UI capture cap fills. */
            if (batch_result_count < capture_limit) {
                SearchResult* result = &batch_results[batch_result_count];
                result->x = cursor_x;
                result->y = cursor_y;
                result->z = cursor_z;
                result->bad_blocks = (uint16_t)bad_blocks;
                result->direction = directions[cursor_direction];
                batch_result_count += 1;
            }
        }

        processed_positions += 1;
        scanned += 1;
        advance_cursor();
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
