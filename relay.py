"""
relay.py — Hand Tracking WebSocket Relay
==========================================
Bridges the browser (MediaPipe) and Unity over WebSocket.

INSTALL DEPENDENCY:
    pip install websockets

RUN:
    python relay.py

CONNECTIONS:
    Browser  →  ws://localhost:8765/browser
    Unity    →  ws://localhost:8765          (any other path)

The relay forwards every message from the browser to all connected
Unity clients. Multiple Unity clients are supported simultaneously.
"""

import asyncio
import websockets
import json
import logging
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("relay")

# ---- Connection sets ----
unity_clients   = set()
browser_clients = set()

# ---- Stats ----
messages_forwarded = 0
start_time = datetime.now()


async def broadcast_to_unity(message: str):
    """Forward a message to all connected Unity clients."""
    global messages_forwarded
    if not unity_clients:
        return

    dead = set()
    for client in unity_clients:
        try:
            await client.send(message)
            messages_forwarded += 1
        except websockets.exceptions.ConnectionClosed:
            dead.add(client)
        except Exception as e:
            log.warning(f"Error sending to Unity client: {e}")
            dead.add(client)

    for d in dead:
        unity_clients.discard(d)
        log.info(f"Unity client disconnected (dead). Remaining: {len(unity_clients)}")


async def handler(websocket, path):
    """Route connections based on path."""
    remote = websocket.remote_address
    log.info(f"New connection from {remote} on path '{path}'")

    if path == "/browser":
        # ---- Browser / MediaPipe client ----
        browser_clients.add(websocket)
        log.info(f"Browser connected. Browser clients: {len(browser_clients)}, Unity clients: {len(unity_clients)}")
        try:
            async for message in websocket:
                await broadcast_to_unity(message)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            browser_clients.discard(websocket)
            log.info(f"Browser disconnected. Browser clients: {len(browser_clients)}")

    else:
        # ---- Unity client ----
        unity_clients.add(websocket)
        log.info(f"Unity connected. Browser clients: {len(browser_clients)}, Unity clients: {len(unity_clients)}")

        # Send a handshake so Unity knows the relay is ready
        try:
            await websocket.send(json.dumps({
                "type":    "relay_ready",
                "message": "Hand tracking relay connected",
                "version": "1.0"
            }))
        except Exception:
            pass

        try:
            # Keep the connection open — Unity doesn't send data upstream
            await websocket.wait_closed()
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            unity_clients.discard(websocket)
            log.info(f"Unity disconnected. Unity clients: {len(unity_clients)}")


async def print_stats():
    """Periodically log relay stats."""
    while True:
        await asyncio.sleep(30)
        uptime = (datetime.now() - start_time).seconds
        log.info(
            f"Stats — uptime: {uptime}s | "
            f"messages forwarded: {messages_forwarded} | "
            f"browser: {len(browser_clients)} | "
            f"unity: {len(unity_clients)}"
        )


async def main():
    PORT = 8765
    log.info("=" * 50)
    log.info("  Hand Tracking WebSocket Relay")
    log.info("=" * 50)
    log.info(f"  Listening on ws://localhost:{PORT}")
    log.info(f"  Browser path : /browser")
    log.info(f"  Unity path   : / (any path)")
    log.info("=" * 50)

    async with websockets.serve(handler, "localhost", PORT):
        await asyncio.gather(
            asyncio.Future(),   # run forever
            print_stats()
        )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Relay stopped.")
