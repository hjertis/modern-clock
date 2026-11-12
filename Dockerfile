# ==============================================================================
# Stage 1: Build Frontend Assets (Node.js)
# ==============================================================================
FROM node:22-alpine AS frontend-builder
WORKDIR /app

# Cache dependency installations
COPY package.json package-lock.json ./
RUN npm ci

# Copy frontend source and configuration files
COPY tsconfig.json vite.config.ts index.html ./
COPY src/ ./src/
COPY public/ ./public/
COPY themes/ ./themes/

# Build static distribution bundle into dist/
RUN npm run build

# ==============================================================================
# Stage 2: Build Rust Backend Daemon
# ==============================================================================
FROM rust:slim-bookworm AS backend-builder
WORKDIR /build

# Install system dependencies needed for compiling native crates
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Cache Cargo dependencies layer
COPY backend/Cargo.toml backend/Cargo.lock ./
RUN mkdir -p src \
    && echo "pub fn dummy() {}" > src/lib.rs \
    && echo "fn main() {}" > src/main.rs \
    && cargo build --release \
    && rm -rf src \
       target/release/.fingerprint/grandfather-clock-backend* \
       target/release/deps/grandfather_clock_backend* \
       target/release/deps/grandfather-clock-backend* \
       target/release/libgrandfather_clock_backend* \
       target/release/grandfather-clock-backend*

# Copy actual Rust backend source files and compile release binary
COPY backend/src/ ./src/
RUN cargo build --release

# ==============================================================================
# Stage 3: Minimal Production Runtime
# ==============================================================================
FROM debian:bookworm-slim AS runtime
WORKDIR /app

# Install CA certificates for secure TLS/MQTT connections
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy compiled backend binary from Stage 2
COPY --from=backend-builder /build/target/release/grandfather-clock-backend /app/grandfather-clock

# Copy compiled static frontend distribution from Stage 1
COPY --from=frontend-builder /app/dist /app/static

# Ensure binary is executable
RUN chmod +x /app/grandfather-clock

# Expose unified HTTP and WebSocket port
EXPOSE 8088

# Default environment variables
ENV PORT=8088
ENV STATIC_DIR=/app/static

CMD ["/app/grandfather-clock"]

