const webpackConfig = require('../../webpack.config.js');

describe('production web shell', () => {
  it('builds from the responsive authored HTML template', () => {
    const htmlPlugin = webpackConfig.plugins.find(
      (plugin: { constructor?: { name?: string } }) => (
        plugin.constructor?.name === 'HtmlWebpackPlugin'
      ),
    );

    expect(htmlPlugin).toBeDefined();
    expect(htmlPlugin.userOptions.template).toBe('./src/index.html');
  });
});
