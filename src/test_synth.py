import sounddevice as sd
from synthesizer import Synthesizer

def test_synth():
    # Create synthesizer instance
    synth = Synthesizer()
    
    # Test different waveforms
    for waveform in ['sine', 'square', 'triangle', 'saw']:
        synth.set_waveform(waveform)
        print(f"Playing {waveform} wave...")
        
        # Generate and play a middle C note
        audio = synth.play_note('C', duration=1.0)
        sd.play(audio, synth.sample_rate)
        sd.wait()  # Wait until the sound has finished playing

if __name__ == "__main__":
    test_synth() 