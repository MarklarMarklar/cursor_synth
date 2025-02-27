import numpy as np
from typing import Literal

class Synthesizer:
    def __init__(self, sample_rate: int = 44100):
        self.sample_rate = sample_rate
        self.amplitude = 0.5
        self.current_octave = 4  # Middle octave
        self.waveform = 'sine'
        
        # ADSR parameters (in seconds)
        self.attack = 0.1
        self.decay = 0.1
        self.sustain = 0.7  # This is a level, not time
        self.release = 0.2
        
        # Note frequencies for middle octave (4)
        self.base_frequencies = {
            'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13,
            'E': 329.63, 'F': 349.23, 'F#': 369.99, 'G': 392.00,
            'G#': 415.30, 'A': 440.00, 'A#': 466.16, 'B': 493.88
        }

    def generate_waveform(
        self, 
        frequency: float, 
        duration: float,
        wave_type: Literal['sine', 'square', 'triangle', 'saw'] = 'sine'
    ) -> np.ndarray:
        """Generate a waveform of specified frequency and duration."""
        t = np.linspace(0, duration, int(self.sample_rate * duration), False)
        
        if wave_type == 'sine':
            wave = np.sin(2 * np.pi * frequency * t)
        elif wave_type == 'square':
            wave = np.sign(np.sin(2 * np.pi * frequency * t))
        elif wave_type == 'triangle':
            wave = 2 * np.abs(2 * (frequency * t - np.floor(0.5 + frequency * t))) - 1
        elif wave_type == 'saw':
            wave = 2 * (frequency * t - np.floor(0.5 + frequency * t))
        else:
            raise ValueError(f"Invalid wave type: {wave_type}")
            
        return wave * self.amplitude

    def apply_adsr(self, wave: np.ndarray, duration: float) -> np.ndarray:
        """Apply ADSR envelope to the waveform."""
        samples = len(wave)
        attack_samples = int(self.attack * self.sample_rate)
        decay_samples = int(self.decay * self.sample_rate)
        release_samples = int(self.release * self.sample_rate)
        
        # Create ADSR envelope
        envelope = np.zeros(samples)
        
        # Attack phase
        if attack_samples > 0:
            envelope[:attack_samples] = np.linspace(0, 1, attack_samples)
        
        # Decay phase
        if decay_samples > 0:
            envelope[attack_samples:attack_samples + decay_samples] = \
                np.linspace(1, self.sustain, decay_samples)
        
        # Sustain phase
        sustain_samples = samples - attack_samples - decay_samples - release_samples
        if sustain_samples > 0:
            envelope[attack_samples + decay_samples:-release_samples] = self.sustain
        
        # Release phase
        if release_samples > 0:
            envelope[-release_samples:] = np.linspace(self.sustain, 0, release_samples)
            
        return wave * envelope

    def get_note_frequency(self, note: str, octave: int = None) -> float:
        """Calculate frequency for a given note and octave."""
        if octave is None:
            octave = self.current_octave
            
        base_freq = self.base_frequencies[note]
        octave_diff = octave - 4  # Relative to middle octave
        return base_freq * (2 ** octave_diff)

    def play_note(self, note: str, duration: float, octave: int = None) -> np.ndarray:
        """Generate a note with the current settings."""
        frequency = self.get_note_frequency(note, octave)
        wave = self.generate_waveform(frequency, duration, self.waveform)
        return self.apply_adsr(wave, duration)

    def set_waveform(self, wave_type: Literal['sine', 'square', 'triangle', 'saw']):
        """Set the current waveform type."""
        if wave_type not in ['sine', 'square', 'triangle', 'saw']:
            raise ValueError(f"Invalid wave type: {wave_type}")
        self.waveform = wave_type

    def set_octave(self, octave: int):
        """Set the current octave (0-8)."""
        if not 0 <= octave <= 8:
            raise ValueError("Octave must be between 0 and 8")
        self.current_octave = octave

    def set_adsr(self, attack: float, decay: float, sustain: float, release: float):
        """Set ADSR envelope parameters."""
        if not all(isinstance(x, (int, float)) for x in [attack, decay, sustain, release]):
            raise ValueError("All ADSR parameters must be numbers")
        if not 0 <= sustain <= 1:
            raise ValueError("Sustain level must be between 0 and 1")
        
        self.attack = max(0, attack)
        self.decay = max(0, decay)
        self.sustain = sustain
        self.release = max(0, release)

    def set_amplitude(self, amplitude: float):
        """Set the amplitude (volume) of the synthesizer."""
        if not 0 <= amplitude <= 1:
            raise ValueError("Amplitude must be between 0 and 1")
        self.amplitude = amplitude 