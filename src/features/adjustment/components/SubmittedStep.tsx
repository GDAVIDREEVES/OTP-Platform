import { Box, Button, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useNavigate } from 'react-router-dom';

export default function SubmittedStep() {
  const navigate = useNavigate();
  return (
    <Box sx={{ textAlign: 'center', py: 4 }}>
      <CheckCircleIcon sx={{ fontSize: 56, color: '#16A34A', mb: 2 }} />
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
        Adjustment submitted
      </Typography>
      <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
        Routed to Sam Rodriguez (Tax Director) for approval. You will be
        notified once reviewed.
      </Typography>
      <Stack direction="row" spacing={1.5} justifyContent="center">
        <Button variant="outlined" onClick={() => navigate('/invoicing')}>
          View invoice
        </Button>
        <Button variant="contained" onClick={() => navigate('/dashboard')}>
          Back to dashboard
        </Button>
      </Stack>
    </Box>
  );
}
