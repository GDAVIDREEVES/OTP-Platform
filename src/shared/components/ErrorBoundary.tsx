import React from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';

interface State {
  error: Error | null;
}

/** Catches render-time errors in a route/binding so a single bad screen shows a
 *  recoverable message instead of white-screening the whole app. */
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Box sx={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  this.setState({ error: null });
                  window.location.assign('/home');
                }}
              >
                Back to home
              </Button>
            }
            sx={{ maxWidth: 640 }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Something went wrong on this screen.
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {this.state.error.message}
            </Typography>
          </Alert>
        </Box>
      );
    }
    return this.props.children;
  }
}
