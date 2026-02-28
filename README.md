# Webcam Whack-a-Mole Hand Capture
Overview

Webcam Whack-a-Mole Hand Capture is a proof-of-concept game that replaces traditional input devices (mouse, keyboard, or VR controllers) with webcam-based hand motion tracking. Players interact with the game by moving their hands in front of a webcam to control actions in a Whack-a-Mole–style environment.

The project demonstrates how hand tracking can be used as an alternative control scheme for games and other interactive applications.

Purpose

The goal of this project is to:
Serve as a Capstone Project for 4 graduating Seniors
Capture hand movements using a webcam.
Translate movements into game controls.
Demonstrate 2D motion and 3D depth tracking for interactive gameplay.
Provide a proof of concept for future applications using gesture-based input.

Features

2D Hand Tracking

Up
Down
Left
Right

3D Depth Tracking

Hand moving toward the camera (in)
Hand moving away from the camera (out)

Whack-a-Mole Gameplay

Hand motions replace mouse clicks or controller input.

Demonstrates feasibility of webcam gesture control in Unity.

How to Use
Requirements

Webcam
Unity Hub & Unity Editor (recommended XXXX LTS or newer)
.NET / C# support enabled

One of the supported hand-tracking frameworks:

MediaPipe?
OpenCV?

Setup

Clone the repository:

git clone <repository-url>

Open the project in Unity Hub.

Ensure your webcam is connected and recognized by your OS.

Run the scene:

Open MainScene (or the primary gameplay scene).

Click Play in the Unity Editor.

Controls - (Two hands held near each other in the center of the camera)
Hand Motion	Action
Move Up	Lift Hammer
Move Down	Strike Hammer
Move Left	Move hammer left
Move Right	Move hammer right
Move up	push hands in
Move back pull hands back




Architecture

Webcam captures video feed.
Hand tracking framework detects hand position.
Movement vectors are translated into Unity input events.
Game logic responds to gestures.

Release Notes
Current Submission Status - Milestone 1,2 = working hand capture, working whack-a-mole game

Working Features





Contributors

Project Team: John Cook, Ben Laffey, Mark Moser, Hunter Nielson
