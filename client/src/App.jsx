import { useState, useEffect } from 'react';
import './index.css';

function App() {
  const [jobs, setJobs] = useState([]);
  const [isScraping, setIsScraping] = useState(false);
  const [lastScraped, setLastScraped] = useState(null);
  const [error, setError] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);

  // Capture the install prompt event
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  }, []);

  const fetchJobs = async () => {
    try {
      const response = await fetch('/api/jobs');
      const data = await response.json();
      
      if (data.success) {
        setJobs(prevJobs => {
          const fetchedJobs = data.jobs || [];
          if (prevJobs.length > 0 && fetchedJobs.length > 0) {
            const currentIds = new Set(prevJobs.map(j => j.id));
            const newJobs = fetchedJobs.filter(j => !currentIds.has(j.id));
            if (newJobs.length > 0 && Notification.permission === 'granted') {
              new Notification('New Microsoft Jobs!', {
                body: `Found ${newJobs.length} new position(s).`,
                icon: 'https://cdn-icons-png.flaticon.com/512/732/732221.png'
              });
            }
          }
          return fetchedJobs;
        });

        setIsScraping(data.isScraping);
        setLastScraped(data.lastScraped);
        setError(data.error);
        
        // If it's scraping, poll again in 1 second
        if (data.isScraping) {
          setTimeout(fetchJobs, 1000);
        }
      }
    } catch (err) {
      setError("Failed to connect to backend");
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const handleScrape = async () => {
    try {
      setIsScraping(true);
      await fetch('/api/scrape', { method: 'POST' });
      // Poll for updates immediately
      setTimeout(fetchJobs, 2000);
    } catch (err) {
      console.error(err);
      setIsScraping(false);
      setError("Failed to initiate scraping");
    }
  };

  const getStatusComponent = () => {
    if (error) {
      return (
        <div className="status-badge error">
          <span className="dot"></span> {error}
        </div>
      );
    }
    if (isScraping) {
      return (
        <div className="status-badge scraping">
          <span className="dot"></span> Scraping LinkedIn...
        </div>
      );
    }
    return (
      <div className="status-badge">
        <span className="dot"></span> Active
      </div>
    );
  };

  const formatTime = (isoString) => {
    if (!isoString) return 'Never checked';
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  };

  return (
    <div className="app-container">
      <header className="header">
        <div className="logo-container">
          <div className="logo-icon">
            <div></div><div></div><div></div><div></div>
          </div>
          <div>
            <h1 className="title">Microsoft Jobs Tracker</h1>
            <p className="subtitle">Real-time internship &amp; job tracking from LinkedIn</p>
          </div>
        </div>
        {installPrompt && (
          <button className="btn btn-install" onClick={handleInstall} title="Install as Android App">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v13M7 11l5 5 5-5"/><rect x="3" y="18" width="18" height="3" rx="1"/>
            </svg>
            Install App
          </button>
        )}
      </header>

      <section className="action-bar">
        <div className="status-info">
          {getStatusComponent()}
          <span style={{ color: 'var(--text-secondary)', marginLeft: '1rem', fontSize: '0.9rem' }}>
            Last checked: {formatTime(lastScraped)}
          </span>
        </div>
        
        <button 
          className="btn" 
          onClick={handleScrape} 
          disabled={isScraping}
        >
          {isScraping ? (
            <>
              <div className="spinner"></div> Syncing...
            </>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.5l-5.45-5.45" />
              </svg>
              Sync Now
            </>
          )}
        </button>
      </section>

      <main className="job-grid">
        {jobs.length === 0 ? (
          <div className="empty-state">
            {isScraping ? "Fetching the latest opportunities..." : "No jobs found. Click 'Sync Now' to refresh."}
          </div>
        ) : (
          jobs.map((job) => (
            <article key={job.id} className="job-card">
              <h2 className="job-title">{job.title}</h2>
              <div className="job-company">
                <svg className="job-company-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.4 0H0v11.4h11.4V0zM24 0H12.6v11.4H24V0zM11.4 12.6H0V24h11.4V12.6zM24 12.6H12.6V24H24V12.6z" />
                </svg>
                {job.company}
              </div>
              <div className="job-location">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                {job.location}
              </div>
              
              <div className="job-footer">
                <span className="job-time">{job.timePosted || 'Recently posted'}</span>
                <a href={job.url} target="_blank" rel="noopener noreferrer" className="job-link">
                  Apply 
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </a>
              </div>
            </article>
          ))
        )}
      </main>
    </div>
  );
}

export default App;
