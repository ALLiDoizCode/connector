// Jest setup file for React Testing Library
import '@testing-library/jest-dom';

// Setup WebSocket mock globally
import { MockWebSocket } from './__mocks__/WebSocket';
(globalThis as typeof globalThis).WebSocket = MockWebSocket as unknown as typeof WebSocket;
