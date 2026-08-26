// The shader is embedded so a release build produces one self-contained arm64
// executable. Metal specializes the texture mode and exact/tolerant search path
// when the compute pipeline is made, removing those choices from the hot loop.
let coordsFinderMetalKernel = #"""
#include <metal_stdlib>
using namespace metal;

constant uint kTextureMode [[function_constant(0)]];
constant bool kExactSearch [[function_constant(1)]];

constant uint candidatesPerThread = 128u;
constant ulong javaMultiplier = 0x5DEECE66Dul;
constant ulong javaMask = (1ul << 48) - 1ul;
constant ulong sodiumPhi = 0x9E3779B97F4A7C15ul;

struct ScanParameters {
    uint workOffsetLow;
    uint workOffsetHigh;
    int xStart;
    int yStart;
    int zStart;
    uint ySizeLow;
    uint ySizeHigh;
    uint zSizeLow;
    uint zSizeHigh;
    uint yBlockCountLow;
    uint yBlockCountHigh;
    uint directionCount;
    uint filterCount;
    uint errorTolerance;
    uint resultCapacity;
    uint scanOrder;
    uint xSizeLow;
    uint xSizeHigh;
};

struct Filter {
    int x;
    int y;
    int z;
    uint rotation;
    uint visibleMask;
};

struct LatticeGateParameters {
    uint workOffsetLow;
    uint workOffsetHigh;
    int xStart;
    int yStart;
    int zStart;
    int xEnd;
    int zEnd;
    uint ySizeLow;
    uint ySizeHigh;
    uint zSizeLow;
    uint zSizeHigh;
    uint yBlockCountLow;
    uint yBlockCountHigh;
    uint filterCount;
    uint resultCapacity;
    int sampleXStart;
    int sampleZStart;
    uint sampleZCountLow;
    uint sampleZCountHigh;
    int gateYOffset;
    uint gateRotation;
    uint directionDegrees;
};

struct LatticeGateOffset {
    int x;
    int y;
    int z;
    uint filterIndex;
};

inline ulong make_ulong(uint low, uint high) {
    return ulong(low) | (ulong(high) << 32);
}

inline int wrap_add(int left, int right) {
    return as_type<int>(as_type<uint>(left) + as_type<uint>(right));
}

inline uint positive_modulo(int value, uint modulus) {
    long wide = long(value);
    ulong positive = ulong(wide < 0 ? -wide : wide);
    return uint(positive % ulong(modulus));
}

inline ulong rotate_left_64(ulong value, uint distance) {
    return (value << distance) | (value >> (64u - distance));
}

inline ulong stafford_mix_13(ulong value) {
    value = (value ^ (value >> 30)) * 0xBF58476D1CE4E5B9ul;
    value = (value ^ (value >> 27)) * 0x94D049BB133111EBul;
    return value ^ (value >> 31);
}

inline ulong coordinate_seed_xz(int x, int z) {
    uint xProductBits = as_type<uint>(x) * 3129871u;
    int xProduct = as_type<int>(xProductBits);
    ulong seed = ulong(long(xProduct));
    seed ^= ulong(long(z)) * 116129781ul;
    return seed;
}

inline ulong coordinate_random_raw_from_xz_seed(ulong xzSeed, int y) {
    ulong seed = xzSeed;
    seed ^= ulong(long(y));
    return seed * seed * 42317861ul + seed * 11ul;
}

inline ulong coordinate_random_raw(int x, int y, int z) {
    return coordinate_random_raw_from_xz_seed(coordinate_seed_xz(x, z), y);
}

inline int coordinate_random_legacy(int x, int y, int z) {
    int low = as_type<int>(uint(coordinate_random_raw(x, y, z)));
    return low >> 16;
}

inline ulong coordinate_random(int x, int y, int z) {
    long shifted = as_type<long>(coordinate_random_raw(x, y, z)) >> 16;
    return as_type<ulong>(shifted);
}

inline int random_vanilla_2(ulong seed) {
    seed = (seed ^ javaMultiplier) & javaMask;
    ulong mixed = seed * 0xBB20B4600A69ul + 0x40942DE6BAul;
    return as_type<int>(uint(mixed >> 16));
}

inline uint legacy_next_int_4(ulong seed) {
    seed = (seed ^ javaMultiplier) & javaMask;
    seed = (seed * javaMultiplier + 11ul) & javaMask;
    uint bits = uint(seed >> 17);
    return uint((4ul * ulong(bits)) >> 31);
}

inline int random_sodium_1(ulong seed) {
    seed ^= seed >> 33;
    seed *= 0xff51afd7ed558ccdul;
    seed ^= seed >> 33;
    seed *= 0xc4ceb9fe1a85ec53ul;
    seed ^= seed >> 33;

    ulong first = stafford_mix_13(seed + sodiumPhi);
    ulong second = stafford_mix_13(seed + sodiumPhi + sodiumPhi);
    return as_type<int>(uint(first + second));
}

inline int random_sodium_2(ulong seed) {
    ulong low = seed ^ 7640891576956012809ul;
    ulong high = low - 7046029254386353131ul;

    low = stafford_mix_13(low);
    high = stafford_mix_13(high);
    return as_type<int>(uint(rotate_left_64(low + high, 17) + low));
}

inline uint texture_variant(int x, int y, int z) {
    ulong xzSeed = coordinate_seed_xz(x, z);
    ulong raw = coordinate_random_raw_from_xz_seed(xzSeed, y);
    switch (kTextureMode) {
    case 0: {
        int low = as_type<int>(uint(raw));
        return positive_modulo(low >> 16, 4u);
    }
    case 1: {
        long shifted = as_type<long>(raw) >> 16;
        return positive_modulo(random_vanilla_2(as_type<ulong>(shifted)), 4u);
    }
    case 2: {
        long shifted = as_type<long>(raw) >> 16;
        return legacy_next_int_4(as_type<ulong>(shifted));
    }
    case 3: {
        long shifted = as_type<long>(raw) >> 16;
        return positive_modulo(random_sodium_1(as_type<ulong>(shifted)), 4u);
    }
    case 4:
    default: {
        long shifted = as_type<long>(raw) >> 16;
        return positive_modulo(random_sodium_2(as_type<ulong>(shifted)), 4u);
    }
    }
}

inline uint texture_variant_from_xz_seed(ulong xzSeed, int y) {
    ulong raw = coordinate_random_raw_from_xz_seed(xzSeed, y);
    switch (kTextureMode) {
    case 0: {
        int low = as_type<int>(uint(raw));
        return positive_modulo(low >> 16, 4u);
    }
    case 1: {
        long shifted = as_type<long>(raw) >> 16;
        return positive_modulo(random_vanilla_2(as_type<ulong>(shifted)), 4u);
    }
    case 2: {
        long shifted = as_type<long>(raw) >> 16;
        return legacy_next_int_4(as_type<ulong>(shifted));
    }
    case 3: {
        long shifted = as_type<long>(raw) >> 16;
        return positive_modulo(random_sodium_1(as_type<ulong>(shifted)), 4u);
    }
    case 4:
    default: {
        long shifted = as_type<long>(raw) >> 16;
        return positive_modulo(random_sodium_2(as_type<ulong>(shifted)), 4u);
    }
    }
}

inline ulong positions_through_radius(
    long radius,
    long centerX,
    long centerZ,
    long xStart,
    long xEnd,
    long zStart,
    long zEnd
) {
    long minX = max(centerX - radius, xStart);
    long maxX = min(centerX + radius, xEnd);
    long minZ = max(centerZ - radius, zStart);
    long maxZ = min(centerZ + radius, zEnd);
    return ulong(maxX - minX + 1) * ulong(maxZ - minZ + 1);
}

inline int2 spiral_coordinates(
    ulong index,
    constant ScanParameters& parameters
) {
    ulong xSize = make_ulong(parameters.xSizeLow, parameters.xSizeHigh);
    ulong zSize = make_ulong(parameters.zSizeLow, parameters.zSizeHigh);
    long xStart = long(parameters.xStart);
    long zStart = long(parameters.zStart);
    long xEnd = xStart + long(xSize) - 1;
    long zEnd = zStart + long(zSize) - 1;
    long centerX = xStart + long(xSize - 1ul) / 2;
    long centerZ = zStart + long(zSize - 1ul) / 2;

    long maximumRadius = max(
        max(centerX - xStart, centerZ - zStart),
        max(xEnd - centerX, zEnd - centerZ)
    );
    long low = 0;
    long high = maximumRadius;
    while (low < high) {
        long middle = low + (high - low) / 2;
        if (positions_through_radius(
            middle,
            centerX,
            centerZ,
            xStart,
            xEnd,
            zStart,
            zEnd
        ) > index) {
            high = middle;
        } else {
            low = middle + 1;
        }
    }

    long radius = low;
    if (radius == 0) {
        return int2(int(centerX), int(centerZ));
    }

    ulong offset = index - positions_through_radius(
        radius - 1,
        centerX,
        centerZ,
        xStart,
        xEnd,
        zStart,
        zEnd
    );
    long from;
    long to;
    ulong length;

    long right = centerX + radius;
    if (right >= xStart && right <= xEnd) {
        from = max(centerZ - radius + 1, zStart);
        to = min(centerZ + radius, zEnd);
        length = ulong(to - from + 1);
        if (offset < length) {
            return int2(int(right), int(from + long(offset)));
        }
        offset -= length;
    }

    long bottom = centerZ + radius;
    if (bottom >= zStart && bottom <= zEnd) {
        from = min(centerX + radius - 1, xEnd);
        to = max(centerX - radius, xStart);
        length = ulong(from - to + 1);
        if (offset < length) {
            return int2(int(from - long(offset)), int(bottom));
        }
        offset -= length;
    }

    long left = centerX - radius;
    if (left >= xStart && left <= xEnd) {
        from = min(centerZ + radius - 1, zEnd);
        to = max(centerZ - radius, zStart);
        length = ulong(from - to + 1);
        if (offset < length) {
            return int2(int(left), int(from - long(offset)));
        }
        offset -= length;
    }

    from = max(centerX - radius + 1, xStart);
    return int2(int(from + long(offset)), int(centerZ - radius));
}

kernel void search_coordinates(
    constant ScanParameters& parameters [[buffer(0)]],
    constant Filter* filters [[buffer(1)]],
    constant uint* directions [[buffer(2)]],
    device atomic_uint* resultCount [[buffer(3)]],
    device atomic_uint* resultOverflow [[buffer(4)]],
    device ulong* resultOrdinals [[buffer(5)]],
    device int4* resultCoordinates [[buffer(6)]],
    device uint* resultDirections [[buffer(7)]],
    uint threadIndex [[thread_position_in_grid]]
) {
    ulong workOffset = make_ulong(parameters.workOffsetLow, parameters.workOffsetHigh);
    ulong ySize = make_ulong(parameters.ySizeLow, parameters.ySizeHigh);
    ulong zSize = make_ulong(parameters.zSizeLow, parameters.zSizeHigh);
    ulong yBlockCount = make_ulong(
        parameters.yBlockCountLow,
        parameters.yBlockCountHigh
    );
    ulong workIndex = workOffset + ulong(threadIndex);
    ulong columnIndex = workIndex / yBlockCount;
    uint yBlockIndex = uint(workIndex % yBlockCount);
    uint directionIndex = uint(columnIndex % ulong(parameters.directionCount));
    ulong xzIndex = columnIndex / ulong(parameters.directionCount);

    int x;
    int z;
    if (parameters.scanOrder == 1u) {
        int2 coordinates = spiral_coordinates(xzIndex, parameters);
        x = coordinates.x;
        z = coordinates.y;
    } else {
        ulong xIndex = xzIndex / zSize;
        ulong zIndex = xzIndex % zSize;
        x = as_type<int>(as_type<uint>(parameters.xStart) + uint(xIndex));
        z = as_type<int>(as_type<uint>(parameters.zStart) + uint(zIndex));
    }

    ulong yBase = ulong(yBlockIndex) * ulong(candidatesPerThread);
    uint yCount = uint(min(ulong(candidatesPerThread), ySize - yBase));
    ulong ordinalBase = columnIndex * ySize + yBase;
    uint filterBase = directionIndex * parameters.filterCount;
    Filter firstFilter = filters[filterBase];
    ulong firstFilterXZSeed = coordinate_seed_xz(
        wrap_add(x, firstFilter.x),
        wrap_add(z, firstFilter.z)
    );

    for (uint yOffset = 0; yOffset < yCount; ++yOffset) {
        int y = as_type<int>(
            as_type<uint>(parameters.yStart) + uint(yBase) + yOffset
        );
        if (kExactSearch) {
            uint firstVariant = texture_variant_from_xz_seed(
                firstFilterXZSeed,
                wrap_add(y, firstFilter.y)
            ) & firstFilter.visibleMask;
            if (firstVariant != firstFilter.rotation) {
                continue;
            }

            bool matched = true;
            for (uint filterIndex = 1u; filterIndex < parameters.filterCount; ++filterIndex) {
                Filter filter = filters[filterBase + filterIndex];
                uint visibleVariant = texture_variant(
                    wrap_add(x, filter.x),
                    wrap_add(y, filter.y),
                    wrap_add(z, filter.z)
                ) & filter.visibleMask;
                if (visibleVariant != filter.rotation) {
                    matched = false;
                    break;
                }
            }
            if (!matched) {
                continue;
            }

            uint resultIndex = atomic_fetch_add_explicit(
                resultCount,
                1u,
                memory_order_relaxed
            );
            if (resultIndex < parameters.resultCapacity) {
                resultOrdinals[resultIndex] = ordinalBase + ulong(yOffset);
                resultCoordinates[resultIndex] = int4(x, y, z, 0);
                resultDirections[resultIndex] = directions[directionIndex] * 90u;
            } else {
                atomic_store_explicit(resultOverflow, 1u, memory_order_relaxed);
            }
            continue;
        }

        uint badBlocks = 0u;
        for (uint filterIndex = 0; filterIndex < parameters.filterCount; ++filterIndex) {
            Filter filter = filters[filterBase + filterIndex];
            uint visibleVariant = texture_variant(
                wrap_add(x, filter.x),
                wrap_add(y, filter.y),
                wrap_add(z, filter.z)
            ) & filter.visibleMask;
            if (visibleVariant != filter.rotation) {
                ++badBlocks;
                if (badBlocks > parameters.errorTolerance) {
                    break;
                }
            }
        }

        if (badBlocks <= parameters.errorTolerance) {
            uint resultIndex = atomic_fetch_add_explicit(
                resultCount,
                1u,
                memory_order_relaxed
            );
            if (resultIndex < parameters.resultCapacity) {
                resultOrdinals[resultIndex] = ordinalBase + ulong(yOffset);
                resultCoordinates[resultIndex] = int4(x, y, z, int(badBlocks));
                resultDirections[resultIndex] = directions[directionIndex] * 90u;
            } else {
                atomic_store_explicit(resultOverflow, 1u, memory_order_relaxed);
            }
        }
    }
}

inline void verify_lattice_hit(
    constant LatticeGateParameters& parameters,
    constant Filter* filters,
    constant LatticeGateOffset* gateOffsets,
    device atomic_uint* resultCount,
    device atomic_uint* resultOverflow,
    device ulong* resultOrdinals,
    device int4* resultCoordinates,
    device uint* resultDirections,
    int sampleX,
    int sampleZ,
    uint candidateYOffset
) {
    ulong ySize = make_ulong(parameters.ySizeLow, parameters.ySizeHigh);
    ulong zSize = make_ulong(parameters.zSizeLow, parameters.zSizeHigh);
    int candidateY = as_type<int>(
        as_type<uint>(parameters.yStart) + candidateYOffset
    );

    for (uint gateIndex = 0u; gateIndex < 4u; ++gateIndex) {
        LatticeGateOffset gate = gateOffsets[gateIndex];
        int candidateX = wrap_add(sampleX, -gate.x);
        int candidateZ = wrap_add(sampleZ, -gate.z);
        if (candidateX < parameters.xStart || candidateX > parameters.xEnd
            || candidateZ < parameters.zStart || candidateZ > parameters.zEnd) {
            continue;
        }

        ulong xIndex = ulong(long(candidateX) - long(parameters.xStart));
        ulong zIndex = ulong(long(candidateZ) - long(parameters.zStart));
        bool matched = true;
        for (uint filterIndex = 0u; filterIndex < parameters.filterCount; ++filterIndex) {
            if (filterIndex == gate.filterIndex) {
                continue;
            }
            Filter filter = filters[filterIndex];
            uint visibleVariant = texture_variant(
                wrap_add(candidateX, filter.x),
                wrap_add(candidateY, filter.y),
                wrap_add(candidateZ, filter.z)
            ) & filter.visibleMask;
            if (visibleVariant != filter.rotation) {
                matched = false;
                break;
            }
        }

        if (!matched) {
            continue;
        }

        uint resultIndex = atomic_fetch_add_explicit(
            resultCount,
            1u,
            memory_order_relaxed
        );
        if (resultIndex < parameters.resultCapacity) {
            resultOrdinals[resultIndex] =
                (xIndex * zSize + zIndex) * ySize + ulong(candidateYOffset);
            resultCoordinates[resultIndex] = int4(candidateX, candidateY, candidateZ, 0);
            resultDirections[resultIndex] = parameters.directionDegrees;
        } else {
            atomic_store_explicit(resultOverflow, 1u, memory_order_relaxed);
        }
    }
}

kernel void search_coordinates_lattice(
    constant LatticeGateParameters& parameters [[buffer(0)]],
    constant Filter* filters [[buffer(1)]],
    constant LatticeGateOffset* gateOffsets [[buffer(2)]],
    device atomic_uint* resultCount [[buffer(3)]],
    device atomic_uint* resultOverflow [[buffer(4)]],
    device ulong* resultOrdinals [[buffer(5)]],
    device int4* resultCoordinates [[buffer(6)]],
    device uint* resultDirections [[buffer(7)]],
    uint threadIndex [[thread_position_in_grid]]
) {
    ulong workOffset = make_ulong(parameters.workOffsetLow, parameters.workOffsetHigh);
    ulong ySize = make_ulong(parameters.ySizeLow, parameters.ySizeHigh);
    ulong yBlockCount = make_ulong(
        parameters.yBlockCountLow,
        parameters.yBlockCountHigh
    );
    ulong sampleZCount = make_ulong(
        parameters.sampleZCountLow,
        parameters.sampleZCountHigh
    );
    ulong workIndex = workOffset + ulong(threadIndex);
    ulong sampleIndex = workIndex / yBlockCount;
    uint yBlockIndex = uint(workIndex % yBlockCount);
    ulong sampleXIndex = sampleIndex / sampleZCount;
    ulong sampleZIndex = sampleIndex % sampleZCount;
    int sampleX = int(long(parameters.sampleXStart) + long(sampleXIndex) * 2l);
    int sampleZ = int(long(parameters.sampleZStart) + long(sampleZIndex) * 2l);
    ulong gateXZSeed = coordinate_seed_xz(sampleX, sampleZ);
    ulong yBase = ulong(yBlockIndex) * ulong(candidatesPerThread);
    uint yCount = uint(min(ulong(candidatesPerThread), ySize - yBase));

    // Build a compact per-thread survivor list first. Threads in a SIMD group
    // then enter the expensive verification loop a similar number of times,
    // instead of leaving most lanes masked after the first four-state test.
    ulong lowHits = 0ul;
    ulong highHits = 0ul;
    for (uint localY = 0u; localY < yCount; ++localY) {
        uint candidateYOffset = uint(yBase) + localY;
        int candidateY = as_type<int>(
            as_type<uint>(parameters.yStart) + candidateYOffset
        );
        uint visibleVariant = texture_variant_from_xz_seed(
            gateXZSeed,
            wrap_add(candidateY, parameters.gateYOffset)
        );
        if (visibleVariant == parameters.gateRotation) {
            if (localY < 64u) {
                lowHits |= 1ul << localY;
            } else {
                highHits |= 1ul << (localY - 64u);
            }
        }
    }

    while (lowHits != 0ul) {
        uint localY = uint(ctz(lowHits));
        lowHits &= lowHits - 1ul;
        verify_lattice_hit(
            parameters,
            filters,
            gateOffsets,
            resultCount,
            resultOverflow,
            resultOrdinals,
            resultCoordinates,
            resultDirections,
            sampleX,
            sampleZ,
            uint(yBase) + localY
        );
    }
    while (highHits != 0ul) {
        uint localY = uint(ctz(highHits)) + 64u;
        highHits &= highHits - 1ul;
        verify_lattice_hit(
            parameters,
            filters,
            gateOffsets,
            resultCount,
            resultOverflow,
            resultOrdinals,
            resultCoordinates,
            resultDirections,
            sampleX,
            sampleZ,
            uint(yBase) + localY
        );
    }
}
"""#
