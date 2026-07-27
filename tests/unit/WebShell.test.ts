const path = require('path');
const webpackConfigFactory = require('../../webpack.config.js');

describe('production web shell', () => {
  it('builds from the responsive authored HTML template', () => {
    const webpackConfig = webpackConfigFactory({}, { mode: 'production' });
    const htmlPlugin = webpackConfig.plugins.find(
      (plugin: { constructor?: { name?: string } }) => (
        plugin.constructor?.name === 'HtmlWebpackPlugin'
      ),
    );

    expect(htmlPlugin).toBeDefined();
    expect(htmlPlugin.userOptions.template).toBe('./src/index.html');
  });

  it('emits browser assets in the Sites client bundle', () => {
    const webpackConfig = webpackConfigFactory({}, { mode: 'production' });

    expect(webpackConfig.output.path).toBe(
      path.resolve(__dirname, '../../dist/client'),
    );
  });
});
