import React from 'react';
import { AccessibilityInfo, Animated, Image } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { SplashScreen } from '../src/screens/SplashScreen';

describe('splash startup', () => {
  let complete: (result: { finished: boolean }) => void;
  let stop: jest.Mock;
  beforeEach(() => {
    stop = jest.fn();
    jest.spyOn(Animated, 'sequence').mockImplementation(() => ({
      start: callback => {
        complete = callback!;
      },
      stop,
      reset: jest.fn(),
    }));
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('finishes once after loading and uses the latest callback', async () => {
    const initial = jest.fn();
    const latest = jest.fn();
    let screen!: Renderer.ReactTestRenderer;
    await act(async () => {
      screen = Renderer.create(<SplashScreen onSplashFinish={initial} />);
    });
    await act(async () => {
      screen.root.findAllByType(Image)[0].props.onLoad();
    });
    expect(initial).not.toHaveBeenCalled();
    await act(async () => {
      screen.update(<SplashScreen onSplashFinish={latest} />);
    });
    await act(async () => {
      complete({ finished: true });
    });
    expect(initial).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(latest).toHaveBeenCalledWith(
      expect.objectContaining({ server_url: expect.any(String) }),
    );
    await act(async () => {
      screen.unmount();
    });
  });

  it('does not navigate after being unmounted', async () => {
    const finish = jest.fn();
    let screen!: Renderer.ReactTestRenderer;
    await act(async () => {
      screen = Renderer.create(<SplashScreen onSplashFinish={finish} />);
    });
    await act(async () => {
      screen.root.findAllByType(Image)[0].props.onLoad();
    });
    await act(async () => {
      screen.unmount();
    });
    expect(stop).toHaveBeenCalled();
    await act(async () => {
      complete({ finished: true });
    });
    expect(finish).not.toHaveBeenCalled();
  });
});
