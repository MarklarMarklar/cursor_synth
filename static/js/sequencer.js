class Sequencer {
    constructor(synth) {
        this.synth = synth;
        this.isEnabled = true;
        this.isPlaying = false;
        this.currentStep = 0;
        this.intervalId = null;

        this.settings = {
            tempo: 120,
            division: 16, // steps per beat
            steps: 64,
            stepsPerRow: 16,
            gateLength: 0.5  // Add gate length setting (50% by default)
        };

        // Initialize sequence data
        this.sequence = Array(this.settings.steps).fill().map(() => ({
            active: false,
            velocity: 0.7,
            note: 'C',
            octave: 4
        }));

        this.selectedSteps = new Set();
        this.copyBuffer = [];
        this.isDragging = false;
        this.dragStartY = 0;
        this.currentDragStep = null;
        this.noteIndex = 0;
        
        // Extended note range (C1 to C7)
        this.availableNotes = [
            // Octave 1
            ...['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(note => ({ note, octave: 1 })),
            // Octave 2
            ...['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(note => ({ note, octave: 2 })),
            // Octave 3
            ...['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(note => ({ note, octave: 3 })),
            // Octave 4
            ...['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(note => ({ note, octave: 4 })),
            // Octave 5
            ...['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(note => ({ note, octave: 5 })),
            // Octave 6
            ...['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(note => ({ note, octave: 6 })),
            // Octave 7
            { note: 'C', octave: 7 }
        ];

        // Adjust initial note index to start at C4
        this.noteIndex = this.availableNotes.findIndex(n => n.note === 'C' && n.octave === 4);

        this.createSequencerGrid();
        this.createVelocityControls();

        // Add tracking for active sequencer notes with timeouts
        this.activeNotes = new Set();
        this.noteTimeouts = new Map();
        this.previewNoteActive = false;
        this.lastPlayedStep = null;
    }

    createSequencerGrid() {
        const grid = document.querySelector('.sequencer-grid');
        grid.innerHTML = '';

        for (let step = 0; step < this.settings.steps; step++) {
            const button = document.createElement('button');
            button.className = 'step-button';
            button.dataset.step = step;
            
            // Mouse down starts note selection
            button.addEventListener('mousedown', (e) => {
                e.preventDefault();
                if (e.button === 0) { // Left click
                    this.startNoteDrag(step, e.clientY);
                }
            });
            
            // Add right click to delete notes
            button.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.deleteStep(step);
            });

            // Mouse move updates note while dragging
            button.addEventListener('mousemove', (e) => {
                if (this.isDragging && this.currentDragStep === step) {
                    this.updateDragNote(e.clientY);
                }
            });

            grid.appendChild(button);
        }

        // Add global mouse up handler
        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.stopNoteDrag();
            }
        });
    }

    createVelocityControls() {
        const controls = document.querySelector('.velocity-controls');
        controls.innerHTML = '';

        // Create all 64 velocity sliders
        for (let step = 0; step < this.settings.steps; step++) {
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = 0;
            slider.max = 1;
            slider.step = 0.01;
            slider.value = 0.7;
            slider.className = 'velocity-slider';
            slider.dataset.step = step;
            
            slider.addEventListener('input', (e) => {
                this.sequence[step].velocity = parseFloat(e.target.value);
            });

            controls.appendChild(slider);
        }
    }

    startNoteDrag(step, startY) {
        // Clean up any existing preview notes
        if (this.previewNoteActive && this.currentDragStep !== null) {
            const prevStep = this.sequence[this.currentDragStep];
            this.synth.stopNote(prevStep.note, prevStep.octave);
            this.previewNoteActive = false;
        }

        this.isDragging = true;
        this.dragStartY = startY;
        this.currentDragStep = step;
        this.lastNoteIndex = this.noteIndex; // Store last note index for smoother transitions
        this.accumulatedDelta = 0; // Add accumulated delta for smoother note changes
        
        // Toggle step if it's not active
        if (!this.sequence[step].active) {
            this.sequence[step].active = true;
            const initialNote = this.availableNotes[this.noteIndex];
            this.sequence[step].note = initialNote.note;
            this.sequence[step].octave = initialNote.octave;
        } else {
            // If step is active, start from its current note
            const { note, octave } = this.sequence[step];
            this.noteIndex = this.availableNotes.findIndex(n => n.note === note && n.octave === octave);
            this.lastNoteIndex = this.noteIndex;
        }
        
        this.updateStepDisplay(step);
        
        // Preview the note
        const { note, octave, velocity } = this.sequence[step];
        this.synth.startNote(note, octave, velocity);
        this.previewNoteActive = true;

        // Add visual feedback
        const button = document.querySelector(`.step-button[data-step="${step}"]`);
        if (button) {
            button.classList.add('dragging');
        }
    }

    updateDragNote(currentY) {
        if (!this.isDragging) return;
        
        const deltaY = this.dragStartY - currentY;
        const sensitivity = 5; // Reduced sensitivity (was 2)
        
        // Accumulate the delta
        this.accumulatedDelta += deltaY;
        
        // Only change note when accumulated delta reaches threshold
        const noteChange = Math.floor(this.accumulatedDelta / sensitivity);
        
        if (noteChange !== 0) {
            let newIndex = this.lastNoteIndex + noteChange;
            newIndex = Math.max(0, Math.min(this.availableNotes.length - 1, newIndex));
            
            if (newIndex !== this.noteIndex) {
                this.noteIndex = newIndex;
                const { note, octave } = this.availableNotes[this.noteIndex];
                
                // Stop previous preview note
                if (this.previewNoteActive) {
                    const prevNote = this.sequence[this.currentDragStep];
                    this.synth.stopNote(prevNote.note, prevNote.octave);
                }
                
                // Update step data
                this.sequence[this.currentDragStep].note = note;
                this.sequence[this.currentDragStep].octave = octave;
                
                const button = document.querySelector(`.step-button[data-step="${this.currentDragStep}"]`);
                if (button) {
                    button.textContent = `${note}${octave}`;
                    // Add visual feedback for note change
                    button.classList.add('note-changing');
                    setTimeout(() => button.classList.remove('note-changing'), 100);
                }
                
                // Play new preview note
                this.synth.startNote(note, octave, this.sequence[this.currentDragStep].velocity);
                this.previewNoteActive = true;
                
                // Reset accumulated delta after note change
                this.accumulatedDelta = 0;
                this.lastNoteIndex = this.noteIndex;
                this.dragStartY = currentY;
            }
        }
    }

    stopNoteDrag() {
        if (this.isDragging && this.currentDragStep !== null) {
            // Stop preview note
            if (this.previewNoteActive) {
                const { note, octave } = this.sequence[this.currentDragStep];
                this.synth.stopNote(note, octave);
                this.previewNoteActive = false;
            }
            
            // Remove visual feedback
            const button = document.querySelector(`.step-button[data-step="${this.currentDragStep}"]`);
            if (button) {
                button.classList.remove('dragging');
                button.classList.remove('note-changing');
            }
        }
        
        this.isDragging = false;
        this.currentDragStep = null;
        this.accumulatedDelta = 0;
    }

    updateStepDisplay(step) {
        const button = document.querySelector(`.step-button[data-step="${step}"]`);
        if (button) {
            button.classList.toggle('active', this.sequence[step].active);
            button.classList.toggle('selected', this.selectedSteps.has(step));
            if (this.sequence[step].active) {
                const { note, octave } = this.sequence[step];
                button.textContent = `${note}${octave}`;
            } else {
                button.textContent = '';
            }
        }
    }

    playStep(step) {
        console.log(`Play step ${step}, enabled: ${this.isEnabled}`);
        this.currentStep = step;
        
        // Update display for all steps
        document.querySelectorAll('.step-button').forEach(button => {
            const stepIdx = parseInt(button.dataset.step);
            button.classList.toggle('current', stepIdx === step);
        });
        
        // Clean up any stuck notes
        if (this.lastPlayedStep !== null && this.lastPlayedStep !== step) {
            this.cleanupStepNotes(this.lastPlayedStep);
        }
        
        this.lastPlayedStep = step;
        
        // Skip if not enabled
        if (!this.isEnabled) return;
        
        // Check if the step is active
        if (this.sequence[step] && this.sequence[step].active) {
            const { note, octave, velocity } = this.sequence[step];
            console.log(`Playing note ${note}${octave} with velocity ${velocity}`);
            
            // Unique ID for this step's note
            const noteId = `seq-${step}-${note}-${octave}`;
            
            // Clean up if already playing
            if (this.activeNotes.has(noteId)) {
                this.cleanupNote(noteId);
            }
            
            // Play the note
            this.synth.playNote(note, octave, velocity);
            this.activeNotes.add(noteId);
            
            // Schedule note release
            const gateLengthMs = this.calculateGateTime();
            const noteTimeout = setTimeout(() => {
                this.synth.stopNote(note, octave);
                this.activeNotes.delete(noteId);
                this.noteTimeouts.delete(noteId);
            }, gateLengthMs);
            
            this.noteTimeouts.set(noteId, noteTimeout);
        }
    }
    
    // Helper to clean up a specific note
    cleanupNote(noteId) {
        if (this.noteTimeouts.has(noteId)) {
            clearTimeout(this.noteTimeouts.get(noteId));
            this.noteTimeouts.delete(noteId);
        }
        
        if (this.activeNotes.has(noteId)) {
            const [, , note, octave] = noteId.split('-');
            this.synth.stopNote(note, octave);
            this.activeNotes.delete(noteId);
        }
    }
    
    // Helper to clean up all notes from a specific step
    cleanupStepNotes(step) {
        // Find all notes from this step
        const stepPrefix = `seq-${step}-`;
        for (const noteId of this.activeNotes) {
            if (noteId.startsWith(stepPrefix)) {
                this.cleanupNote(noteId);
            }
        }
    }

    start() {
        if (this.isPlaying) return;
        
        // Make sure audio context is running
        if (this.synth.audioContext.state === 'suspended') {
            this.synth.audioContext.resume().then(() => {
                console.log("Audio context resumed");
            });
        }
        
        console.log("Starting sequencer");
        
        // Always enable
        this.isEnabled = true;
        this.isPlaying = true;
        
        // Update UI
        const playButton = document.getElementById('seq-play');
        if (playButton) {
            playButton.textContent = 'Stop';
            playButton.classList.add('playing');
        }
        
        // Calculate step time
        const stepTime = (60000 / this.settings.tempo) / (this.settings.division / 4);
        console.log(`Sequencer timing: ${this.settings.tempo} BPM, ${stepTime}ms per step`);
        
        // Reset step counter to ensure we start from the beginning
        this.currentStep = 0;
        
        // Clear any existing interval just to be safe
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        
        // Clean up any active notes to prevent hanging notes
        this.cleanupAllNotes();
        
        // Play first step immediately
        console.log(`Playing initial step ${this.currentStep}`);
        this.playStep(this.currentStep);
        this.currentStep = (this.currentStep + 1) % this.settings.steps;
        
        // Start interval with window.setInterval for more reliability
        this.intervalId = window.setInterval(() => {
            // Check if interval should still be running
            if (!this.isPlaying) {
                console.log("Stopping interval as sequencer is no longer playing");
                clearInterval(this.intervalId);
                this.intervalId = null;
                return;
            }
            
            console.log(`Playing step ${this.currentStep}, interval ID: ${this.intervalId}`);
            this.playStep(this.currentStep);
            this.currentStep = (this.currentStep + 1) % this.settings.steps;
        }, stepTime);
        
        console.log(`Interval started with ID: ${this.intervalId}`);
    }

    stop() {
        console.log(`Stopping sequencer, interval ID: ${this.intervalId}`);
        
        if (this.intervalId) {
            window.clearInterval(this.intervalId);
            this.intervalId = null;
        }
        
        this.isPlaying = false;
        
        // Clean up all active sequencer notes
        for (const noteId of this.activeNotes) {
            this.cleanupNote(noteId);
        }
        
        // Reset button states
        const playButton = document.querySelector('#seq-play');
        if (playButton) {
            playButton.textContent = 'Play';
            playButton.classList.remove('playing');
        }
        
        console.log("Sequencer stopped");
    }

    updateCurrentStepIndicator() {
        // This is now handled in playStep
    }

    updateVelocitySliders() {
        // Update all velocity sliders
        const sliders = document.querySelectorAll('.velocity-slider');
        sliders.forEach((slider, index) => {
            slider.value = this.sequence[index].velocity;
        });
    }

    setTempo(bpm) {
        this.settings.tempo = Math.max(30, Math.min(300, bpm));
        if (this.isPlaying) {
            this.stop();
            this.start();
        }
    }

    setDivision(division) {
        this.settings.division = parseInt(division);
        if (this.isPlaying) {
            this.stop();
            this.start();
        }
    }

    toggle() {
        if (this.isPlaying) {
            this.stop();
        } else {
            // Always enable when starting
            this.isEnabled = true;
            this.start();
        }
    }

    setGateLength(length) {
        this.settings.gateLength = Math.max(0.1, Math.min(1, parseFloat(length)));
    }

    setLength(newLength) {
        // Stop if playing
        const wasPlaying = this.isPlaying;
        if (wasPlaying) {
            this.stop();
        }

        // Update settings
        this.settings.steps = parseInt(newLength);
        
        // Preserve existing sequence data
        const oldSequence = [...this.sequence];
        
        // Create new sequence array
        this.sequence = Array(this.settings.steps).fill().map((_, i) => {
            if (i < oldSequence.length) {
                return oldSequence[i]; // Keep existing data
            } else {
                return {
                    active: false,
                    velocity: 0.7,
                    note: 'C',
                    octave: 4
                };
            }
        });

        // Recreate grid and velocity controls
        this.createSequencerGrid();
        this.createVelocityControls();

        // Update the visual state of all buttons
        for (let step = 0; step < this.settings.steps; step++) {
            const button = document.querySelector(`.step-button[data-step="${step}"]`);
            if (button && this.sequence[step]) {
                button.classList.toggle('active', this.sequence[step].active);
                if (this.sequence[step].active) {
                    const { note, octave } = this.sequence[step];
                    button.textContent = `${note}${octave}`;
                } else {
                    button.textContent = '';
                }
            }
        }

        // Update velocity sliders
        const velocitySliders = document.querySelectorAll('.velocity-slider');
        velocitySliders.forEach((slider, index) => {
            if (this.sequence[index]) {
                slider.value = this.sequence[index].velocity;
            }
        });

        // Update current step if needed
        if (this.currentStep >= this.settings.steps) {
            this.currentStep = 0;
        }

        // Restart if was playing
        if (wasPlaying) {
            this.start();
        }

        console.log(`Sequencer length changed to ${newLength} steps`);
    }

    deleteStep(step) {
        // Clean up any playing notes from this step
        this.cleanupStepNotes(step);
        
        // Reset step data
        this.sequence[step].active = false;
        this.sequence[step].note = 'C';
        this.sequence[step].octave = 4;
        this.sequence[step].velocity = 0.7;
        
        // Update display
        this.updateStepDisplay(step);
    }

    cleanupAllNotes() {
        // Clean up all active sequencer notes
        for (const noteId of this.activeNotes) {
            this.cleanupNote(noteId);
        }
        
        // Clear collections
        this.activeNotes.clear();
        
        // Clear all timeouts
        for (const timeout of this.noteTimeouts.values()) {
            clearTimeout(timeout);
        }
        this.noteTimeouts.clear();
    }

    calculateGateTime() {
        const stepDuration = (60 / this.settings.tempo) * (4 / this.settings.division) * 1000;
        return stepDuration * this.settings.gateLength;
    }
} 