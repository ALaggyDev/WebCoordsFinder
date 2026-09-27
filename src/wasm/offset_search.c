#include <stdint.h>

#define EXPORT(name) __attribute__((export_name(name)))
#define MAX_CONSTRAINTS 256
#define MAX_RESULTS 1000

typedef struct {
    int32_t dx, dz;
    uint32_t target, mask;
} Constraint;

typedef struct {
    int32_t x, z;
} Result;

static Constraint constraints[MAX_CONSTRAINTS];
static Result results[MAX_RESULTS];
static uint32_t constraint_count, result_count, next_x, end_x;
static uint64_t match_count;
static int32_t min_x, max_x, min_z, max_z;

/* All arithmetic is deliberately wrapped to match the coordinate seed's u32 math. */
static uint32_t coordinate_seed(uint32_t x, uint32_t z)
{
    uint32_t seed = (x * 3129871u) ^ (z * 116129781u);
    return seed * seed * 42317861u + seed * 11u;
}

/* A partial coordinate survives only if some signed 28-bit completion is in range. */
static int within_bound(uint32_t value, uint32_t bits, int32_t minimum, int32_t maximum)
{
    uint32_t mask = (1u << bits) - 1u;
    uint32_t distance = (value - (uint32_t)minimum) & mask;
    return (int64_t)minimum + distance <= maximum;
}

static void lift(uint32_t x, uint32_t z, uint32_t bits)
{
    if (bits == 28) {
        int32_t world_x = (int32_t)(x << 4) >> 4;
        int32_t world_z = (int32_t)(z << 4) >> 4;
        if (world_x < min_x || world_x > max_x ||
            world_z < min_z || world_z > max_z) return;
        match_count++;
        if (result_count < MAX_RESULTS) {
            results[result_count].x = world_x;
            results[result_count].z = world_z;
            result_count++;
        }
        return;
    }

    for (uint32_t option = 0; option < 4; option++) {
        uint32_t new_x = x | ((option & 1u) << bits);
        uint32_t new_z = z | ((option >> 1) << bits);
        if (!within_bound(new_x, bits + 1, min_x, max_x) ||
            !within_bound(new_z, bits + 1, min_z, max_z)) continue;

        uint32_t known = (1u << (bits + 1)) - 1u;
        uint32_t index;
        for (index = 0; index < constraint_count; index++) {
            Constraint *constraint = &constraints[index];
            uint32_t seed = coordinate_seed(
                new_x + (uint32_t)constraint->dx,
                new_z + (uint32_t)constraint->dz);
            uint32_t mask = known & constraint->mask;
            if ((seed & mask) != (constraint->target & mask)) break;
        }
        if (index == constraint_count) lift(new_x, new_z, bits + 1);
    }
}

EXPORT("offset_configure")
int32_t offset_configure(uint32_t x_start, uint32_t x_end,
                         int32_t x_min, int32_t x_max,
                         int32_t z_min, int32_t z_max,
                         uint32_t count)
{
    if (x_start >= x_end || x_end > 65536u || count == 0 ||
        count > MAX_CONSTRAINTS || x_min > x_max || z_min > z_max) return 1;
    next_x = x_start;
    end_x = x_end;
    min_x = x_min;
    max_x = x_max;
    min_z = z_min;
    max_z = z_max;
    constraint_count = count;
    result_count = 0;
    match_count = 0;
    return 0;
}

EXPORT("offset_set_constraint")
int32_t offset_set_constraint(uint32_t index, int32_t dx, int32_t dz,
                              uint32_t offx, uint32_t offy, uint32_t offz,
                              uint32_t x_mask, uint32_t z_mask, uint32_t full)
{
    if (index >= constraint_count || offx > 15 || offy > 15 ||
        offz > 15 || x_mask > 15 || z_mask > 15 || full > 1) return 1;
    constraints[index].dx = dx;
    constraints[index].dz = dz;
    constraints[index].target = (offz << 24) | (offy << 20) | (offx << 16);
    constraints[index].mask = (z_mask << 24) |
        (full ? 0x00f00000u : 0u) | (x_mask << 16);
    return 0;
}

/* Scan whole X prefixes so the JavaScript worker can yield between batches. */
EXPORT("offset_scan_batch")
uint32_t offset_scan_batch(uint32_t x_count)
{
    uint32_t scanned = 0;
    while (next_x < end_x && scanned < x_count) {
        if (within_bound(next_x, 16, min_x, max_x)) {
            for (uint32_t z = 0; z < 65536u; z++) {
                if (within_bound(z, 16, min_z, max_z)) lift(next_x, z, 16);
            }
        }
        next_x++;
        scanned++;
    }
    return scanned;
}

EXPORT("offset_get_next_x") uint32_t offset_get_next_x(void) { return next_x; }
EXPORT("offset_get_matches") uint64_t offset_get_matches(void) { return match_count; }
EXPORT("offset_get_result_count") uint32_t offset_get_result_count(void) { return result_count; }
EXPORT("offset_get_result_x") int32_t offset_get_result_x(uint32_t i) { return i < result_count ? results[i].x : 0; }
EXPORT("offset_get_result_z") int32_t offset_get_result_z(uint32_t i) { return i < result_count ? results[i].z : 0; }
