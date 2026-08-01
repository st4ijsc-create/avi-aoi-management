using System.Collections;
using System.Windows;
using System.Windows.Controls;

namespace St4iMachineSimulator.Controls;

/// <summary>
/// Task 16 — AOI board view (see <c>BoardView.xaml</c>'s remarks for the rendering approach). Purely
/// presentational: exposes <see cref="Points"/> (the item source — bound from
/// <c>MachineViewModel.BoardPoints</c>) and the assumed board coordinate-space size as dependency
/// properties, same "DP in, DataTrigger/style does the rest" shape as <see cref="StatusLight"/>.
/// </summary>
public partial class BoardView : UserControl
{
    public static readonly DependencyProperty PointsProperty =
        DependencyProperty.Register(
            nameof(Points),
            typeof(IEnumerable),
            typeof(BoardView),
            new PropertyMetadata(null));

    /// <summary>Assumed board image width in pixels — the coordinate space <see cref="Points"/>'
    /// <c>Bbox.X</c>/<c>Bbox.W</c> values are expressed in. Defaults to 1600, matching
    /// <c>AoiInspectorSim.BoardWidthPx</c> (this build's only AOI bbox source); override per-instance
    /// if a real/other inspection program uses a different resolution.</summary>
    public static readonly DependencyProperty BoardWidthPxProperty =
        DependencyProperty.Register(
            nameof(BoardWidthPx),
            typeof(double),
            typeof(BoardView),
            new PropertyMetadata(1600.0));

    /// <summary>Assumed board image height in pixels — see <see cref="BoardWidthPxProperty"/> remarks.
    /// Defaults to 1200, matching <c>AoiInspectorSim.BoardHeightPx</c>.</summary>
    public static readonly DependencyProperty BoardHeightPxProperty =
        DependencyProperty.Register(
            nameof(BoardHeightPx),
            typeof(double),
            typeof(BoardView),
            new PropertyMetadata(1200.0));

    public IEnumerable? Points
    {
        get => (IEnumerable?)GetValue(PointsProperty);
        set => SetValue(PointsProperty, value);
    }

    public double BoardWidthPx
    {
        get => (double)GetValue(BoardWidthPxProperty);
        set => SetValue(BoardWidthPxProperty, value);
    }

    public double BoardHeightPx
    {
        get => (double)GetValue(BoardHeightPxProperty);
        set => SetValue(BoardHeightPxProperty, value);
    }

    public BoardView()
    {
        InitializeComponent();
    }
}
