import { MatchupPanel } from "./components/MatchupPanel";
import { PartnerPane } from "./components/PartnerPane";
import { VideoPanel } from "./components/VideoPanel";
import "./App.css";

function App() {
  return (
    <div className="app-grid">
      <section className="area-game">
        <VideoPanel />
      </section>

      <aside className="area-sidebar">
        <PartnerPane />
      </aside>

      <section className="area-panel">
        <MatchupPanel />
      </section>
    </div>
  );
}

export default App;
