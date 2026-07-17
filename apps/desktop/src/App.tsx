import { MatchupPanel } from "./components/MatchupPanel";
import { VideoPanel } from "./components/VideoPanel";
import "./App.css";

function App() {
  return (
    <div className="app-grid">
      <section className="area-game">
        <VideoPanel />
      </section>

      <aside className="area-sidebar">
        <div className="companion-pane">
          <div className="companion-header">
            <span className="companion-title">COMPANION</span>
            <span className="companion-phase">Phase 3/4 で実装</span>
          </div>
          <div className="companion-stage">
            <div className="avatar-ring">
              <span className="avatar-face">(・∀・)</span>
            </div>
            <div className="speech-bubble">
              実況コメントはここに表示されるよ。ローカルLLMが対戦を見ながら喋る予定！
            </div>
          </div>
        </div>
      </aside>

      <section className="area-panel">
        <MatchupPanel />
      </section>
    </div>
  );
}

export default App;
