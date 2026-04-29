import React from 'react';
import { Fab, Tooltip, Box } from '@mui/material';
import PsychologyIcon from '@mui/icons-material/Psychology';
import { useResearchBrain } from './ResearchBrainContext';
export default function ResearchBrainFab() {
  const { openPanel, open } = useResearchBrain();
  if (open) return null;
  return (
    <Tooltip title="Ask Research Brain" placement="left">
      <Fab
        color="secondary"
        onClick={() => openPanel()}
        aria-label="Open Research Brain"
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 1200,
          bgcolor: '#2563EB',
          '&:hover': {
            bgcolor: '#1D4ED8'
          },
          boxShadow: '0 10px 25px rgba(37, 99, 235, 0.4)'
        }}>
        
        <Box
          sx={{
            position: 'relative'
          }}>
          
          <PsychologyIcon />
          <Box
            className="rb-pulse-dot"
            sx={{
              position: 'absolute',
              top: -2,
              right: -4,
              width: 10,
              height: 10,
              borderRadius: '50%',
              bgcolor: '#22C55E',
              border: '2px solid white'
            }} />
          
        </Box>
      </Fab>
    </Tooltip>);

}