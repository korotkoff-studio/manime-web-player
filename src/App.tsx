// src/App.tsx
import React from 'react';
import Player from './components/Player';

const App: React.FC = () => {
  const videoSrc = 'https://ik.imagekit.io/e8tditfh8c/demo.mp4';

  return (
    <div>
      <Player src={videoSrc} />
    </div>
  );
};

export default App;
