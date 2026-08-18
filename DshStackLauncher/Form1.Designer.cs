namespace DshStackLauncher;

partial class Form1
{
    private System.ComponentModel.IContainer components = null;

    protected override void Dispose(bool disposing)
    {
        if (disposing && (components != null))
        {
            components.Dispose();
        }
        base.Dispose(disposing);
    }

    // UI is built entirely in code inside Form1.cs (BuildUi), so there is
    // nothing generated here.
    private void InitializeComponent()
    {
        this.components = new System.ComponentModel.Container();
        this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
        this.ClientSize = new System.Drawing.Size(780, 540);
        this.Text = "DeepSeek Harness Stack";
    }
}
